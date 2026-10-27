param([string]$PayloadDir)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $packageVersion) { throw 'Missing version in package.json' }
# 默认取 electron-builder 的标准产物目录；可用 -PayloadDir 参数或 GW_PAYLOAD_DIR 覆盖
# （例如旧 win-unpacked 因被占用而无法清理时，改输出到 release2 再指过来）
$sourceDirectory = Join-Path $projectRoot 'release\win-unpacked'
if ($PayloadDir) { $sourceDirectory = $PayloadDir }
elseif ($env:GW_PAYLOAD_DIR) { $sourceDirectory = $env:GW_PAYLOAD_DIR }
Write-Host "payload dir: $sourceDirectory"
$buildDirectory = Join-Path $projectRoot 'build'
$outputDirectory = Join-Path $projectRoot 'release-branded'
$payloadPath = Join-Path $buildDirectory 'installer-payload.zip'
$uninstallerPath = Join-Path $buildDirectory 'GIWIN-Uninstaller.exe'
$installerPath = Join-Path $outputDirectory ("GIWIN-Studio-$packageVersion-Beta-Setup.exe")
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$iconPath = Join-Path $projectRoot 'icon.ico'

if (-not (Test-Path -LiteralPath $sourceDirectory)) {
    throw "Missing application payload: $sourceDirectory"
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw "Missing C# compiler: $compiler"
}

New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

if (Test-Path -LiteralPath $payloadPath) {
    Remove-Item -LiteralPath $payloadPath -Force
}
if (Test-Path -LiteralPath $installerPath) {
    Remove-Item -LiteralPath $installerPath -Force
}
$blockMapPath = $installerPath + '.blockmap'
if (Test-Path -LiteralPath $blockMapPath) {
    Remove-Item -LiteralPath $blockMapPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $sourceDirectory,
    $payloadPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

$versionSourcePath = Join-Path $buildDirectory 'AppVersion.g.cs'
$versionAssembly = "$packageVersion.0"
$versionLines = @(
    'namespace Giwin.Installer',
    '{',
    '    internal static class AppVersion',
    '    {',
    '        public const string Display = "{{V}}";',
    '        public const string Assembly = "{{A}}";',
    '        public const string Chip = "{{V}}  BETA";',
    '        public const string Marker = "GIWIN Studio\r\nVersion={{V}}\r\nBrand=\u96c6\u7269\r\n";',
    '        public const string InstallerFileName = "GIWIN-Studio-{{V}}-Beta-Setup.exe";',
    '    }',
    '}',
    ''
)
$versionLines = $versionLines | ForEach-Object { ($_ -replace '\{\{V\}\}', $packageVersion) -replace '\{\{A\}\}', $versionAssembly }
[System.IO.File]::WriteAllLines($versionSourcePath, $versionLines, (New-Object System.Text.UTF8Encoding($true)))
Write-Output "AppVersion.g.cs -> $packageVersion"

& $compiler `
    /nologo `
    /target:winexe `
    /codepage:65001 `
    /optimize+ `
    /win32icon:$iconPath `
    /out:$uninstallerPath `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    $versionSourcePath `
    (Join-Path $PSScriptRoot 'UiKit.cs') `
    (Join-Path $PSScriptRoot 'Uninstaller.cs')

if ($LASTEXITCODE -ne 0) {
    throw "Uninstaller compilation failed."
}

& $compiler `
    /nologo `
    /target:winexe `
    /codepage:65001 `
    /optimize+ `
    /win32icon:$iconPath `
    /out:$installerPath `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll `
    /resource:$payloadPath,payload.zip `
    /resource:$uninstallerPath,uninstall.exe `
    $versionSourcePath `
    (Join-Path $PSScriptRoot 'UiKit.cs') `
    (Join-Path $PSScriptRoot 'Installer.cs')

if ($LASTEXITCODE -ne 0) {
    throw "Installer compilation failed."
}

Get-Item -LiteralPath $installerPath,
    $uninstallerPath,
    $payloadPath |
    Select-Object Name, Length, LastWriteTime
