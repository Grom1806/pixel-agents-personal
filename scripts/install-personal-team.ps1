param(
    [switch]$NoDesktopShortcut
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-NodeMajorVersion {
    try {
        $version = & node --version 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $version) { return 0 }
        return [int](($version -replace '^v', '').Split('.')[0])
    } catch { return 0 }
}

if ((Get-NodeMajorVersion) -lt 20) {
    throw "Node.js 20 or newer is required. Install it from https://nodejs.org/ and run setup again."
}

Set-Location $repo
Write-Host "`nPixel Agents Personal: installing dependencies..." -ForegroundColor Cyan
& npm.cmd install
if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed." }

Write-Host "Building application..." -ForegroundColor Cyan
& npm.cmd run build:extension
if ($LASTEXITCODE -ne 0) { throw "Server build failed." }
& npm.cmd run build:webview
if ($LASTEXITCODE -ne 0) { throw "Web interface build failed." }

if (-not $NoDesktopShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcut = Join-Path $desktop 'Pixel Agents Personal.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($shortcut)
    $link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $startScript = Join-Path $repo 'scripts\start-personal-team.ps1'
    $link.Arguments = ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $startScript)
    $link.WorkingDirectory = $repo
    $link.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
    $link.Description = 'Open the personal CodeX and Cloudy team'
    $link.Save()
    Write-Host "Desktop shortcut created: $shortcut" -ForegroundColor Green
}

Write-Host "`nDone. Run 'Start Pixel Agents Personal.cmd' or use the desktop shortcut." -ForegroundColor Green
