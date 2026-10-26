$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $projectRoot 'release\win-unpacked'
$buildDirectory = Join-Path $projectRoot 'build'
$outputDirectory = Join-Path $projectRoot 'release-branded'
$payloadPath = Join-Path $buildDirectory 'installer-payload.zip'
$uninstallerPath = Join-Path $buildDirectory 'GIWIN-Uninstaller.exe'
$installerPath = Join-Path $outputDirectory 'GIWIN-Studio-0.4.27-Beta-Setup.exe'
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

& $compiler `
    /nologo `
    /target:winexe `
    /codepage:65001 `
    /optimize+ `
    /win32icon:$iconPath `
    /out:$uninstallerPath `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
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
    (Join-Path $PSScriptRoot 'UiKit.cs') `
    (Join-Path $PSScriptRoot 'Installer.cs')

if ($LASTEXITCODE -ne 0) {
    throw "Installer compilation failed."
}

Get-Item -LiteralPath $installerPath,
    $uninstallerPath,
    $payloadPath |
    Select-Object Name, Length, LastWriteTime
