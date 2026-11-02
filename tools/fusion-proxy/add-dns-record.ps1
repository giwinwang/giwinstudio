# ============================================================================
# 极物融合 · 阿里云 DNS 记录管理（免安装 aliyun CLI）
#
# 为什么手写签名：本机没有 aliyun CLI，且沙箱禁止起子进程。
# 这里用阿里云 RPC 签名（HMAC-SHA1）直接调 alidns 接口，纯 PowerShell。
#
# 用法：
#   # 先看现有记录（只读，安全）
#   .\add-dns-record.ps1 -Action Query
#
#   # 把 api.giwin.cn 指向服务器
#   .\add-dns-record.ps1 -Action Set -RR api -Value 203.0.113.10
#
# 凭据来源（按优先级）：
#   -KeyId / -KeySecret 参数
#   -ConfigFile 指定的 ini（默认读 ~/.ossutilconfig，格式同 ossutil）
#
# 需要权限：alidns:DescribeDomainRecords + alidns:AddDomainRecord (+ UpdateDomainRecord)
# 只有 OSS 权限的 RAM 子账号会被拒绝，返回 Forbidden.RAM。
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet('Query', 'Set', 'Delete')]
    [string]$Action = 'Query',

    [string]$Domain = 'giwin.cn',
    [string]$RR = 'api',
    [string]$Value = '',

    [ValidateSet('A', 'CNAME')]
    [string]$Type = 'A',

    [int]$TTL = 600,

    [string]$KeyId = '',
    [string]$KeySecret = '',
    [string]$ConfigFile = "$env:USERPROFILE\.ossutilconfig"
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ 凭据
if (-not $KeyId -or -not $KeySecret) {
    if (-not (Test-Path $ConfigFile)) {
        throw "找不到凭据文件 $ConfigFile，请用 -KeyId/-KeySecret 传入"
    }
    $lines = Get-Content $ConfigFile -Encoding UTF8
    $KeyId = ($lines | Select-String 'accessKeyID\s*=\s*(\S+)').Matches.Groups[1].Value.Trim()
    $KeySecret = ($lines | Select-String 'accessKeySecret\s*=\s*(\S+)').Matches.Groups[1].Value.Trim()
}
if (-not $KeyId -or -not $KeySecret) { throw "凭据不完整：读不到 accessKeyID / accessKeySecret" }

# --------------------------------------------------------------- 签名工具
function ConvertTo-Pe([string]$s) {
    ([System.Uri]::EscapeDataString($s) -replace '\+', '%20' -replace '\*', '%2A' -replace '%7E', '~')
}

function Invoke-AliDns {
    param([string]$ApiAction, [hashtable]$Extra)

    $p = @{
        Format           = 'JSON'
        AccessKeyId      = $KeyId
        SignatureMethod  = 'HMAC-SHA1'
        SignatureNonce   = [guid]::NewGuid().ToString()
        SignatureVersion = '1.0'
        Timestamp        = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        Version          = '2015-01-09'
        Action           = $ApiAction
    }
    foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }

    $pairs = @()
    foreach ($k in ($p.Keys | Sort-Object)) {
        $pairs += (ConvertTo-Pe $k) + '=' + (ConvertTo-Pe ([string]$p[$k]))
    }
    $cqs = $pairs -join '&'
    $sts = 'GET&' + (ConvertTo-Pe '/') + '&' + (ConvertTo-Pe $cqs)

    $hmac = New-Object System.Security.Cryptography.HMACSHA1
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($KeySecret + '&')
    $sig = [Convert]::ToBase64String($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($sts)))

    $url = 'https://alidns.aliyuncs.com/?Signature=' + (ConvertTo-Pe $sig) + '&' + $cqs

    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Proxy = $null
    $req.Method = 'GET'
    $req.Timeout = 25000
    try {
        $resp = $req.GetResponse()
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        return ($sr.ReadToEnd() | ConvertFrom-Json)
    }
    catch [System.Net.WebException] {
        $we = $_.Exception
        if ($we.Response) {
            $sr = New-Object System.IO.StreamReader($we.Response.GetResponseStream())
            $body = $sr.ReadToEnd()
            $code = ''
            try { $code = ($body | ConvertFrom-Json).Code } catch {}
            if ($code -eq 'Forbidden.RAM') {
                throw "这把 Key 没有 DNS 权限（Forbidden.RAM）。请到阿里云 RAM 控制台给该用户授予 AliyunDNSFullAccess，或换一把有权限的 Key。"
            }
            throw "阿里云返回 HTTP $([int]$we.Response.StatusCode)：$body"
        }
        throw "请求失败：$($we.Message)"
    }
}

# ------------------------------------------------------------------ 执行
Write-Host "域名：$Domain" -ForegroundColor Cyan

$list = Invoke-AliDns -ApiAction 'DescribeDomainRecords' -Extra @{
    DomainName = $Domain
    RRKeyWord  = $RR
    PageSize   = 100
}

$existing = @($list.DomainRecords | Where-Object { $_.RR -eq $RR })

if ($Action -eq 'Query') {
    if (-not $existing.Count) {
        Write-Host "没有 $RR 记录" -ForegroundColor Yellow
    }
    else {
        $existing | Select-Object RR, Type, Value, TTL, Status, RecordId | Format-Table -AutoSize
    }
    Write-Host "（共 $($list.TotalCount) 条记录）" -ForegroundColor DarkGray
    return
}

if ($Action -eq 'Set') {
    if (-not $Value) { throw "Set 需要 -Value（目标 IP 或 CNAME）" }

    $hit = $existing | Where-Object { $_.Type -eq $Type } | Select-Object -First 1

    if ($hit) {
        if ($hit.Value -eq $Value) {
            Write-Host "已存在且指向一致，无需改动：$RR.$Domain -> $Value" -ForegroundColor Green
            return
        }
        $r = Invoke-AliDns -ApiAction 'UpdateDomainRecord' -Extra @{
            RecordId = $hit.RecordId
            RR       = $RR
            Type     = $Type
            Value    = $Value
            TTL      = $TTL
        }
        Write-Host "已更新：$RR.$Domain  $($hit.Value) -> $Value（RecordId $($r.RecordId)）" -ForegroundColor Green
    }
    else {
        $r = Invoke-AliDns -ApiAction 'AddDomainRecord' -Extra @{
            DomainName = $Domain
            RR         = $RR
            Type       = $Type
            Value      = $Value
            TTL        = $TTL
        }
        Write-Host "已新增：$RR.$Domain -> $Value（RecordId $($r.RecordId)）" -ForegroundColor Green
    }

    Write-Host "等待解析生效（TTL $TTL 秒，实际通常 1~2 分钟）…" -ForegroundColor DarkGray
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Seconds 10
        $now = @(Resolve-DnsName -Name "$RR.$Domain" -Type $Type -Server 223.5.5.5 -ErrorAction SilentlyContinue |
                 Where-Object { $_.Type -eq $Type })
        $got = if ($Type -eq 'A') { ($now | Select-Object -First 1).IPAddress } else { ($now | Select-Object -First 1).NameHost }
        if ($got -eq $Value) {
            Write-Host "解析已生效：$RR.$Domain -> $got" -ForegroundColor Green
            return
        }
        Write-Host "  第 $($i + 1) 次查询：$got" -ForegroundColor DarkGray
    }
    Write-Host "12 次轮询仍未生效，请稍后手动确认（Resolve-DnsName $RR.$Domain）" -ForegroundColor Yellow
    return
}

if ($Action -eq 'Delete') {
    if (-not $existing.Count) { Write-Host "没有可删的 $RR 记录" -ForegroundColor Yellow; return }
    foreach ($rec in $existing) {
        Invoke-AliDns -ApiAction 'DeleteDomainRecord' -Extra @{ RecordId = $rec.RecordId } | Out-Null
        Write-Host "已删除 $($rec.RR) $($rec.Type) $($rec.Value)" -ForegroundColor Green
    }
}
