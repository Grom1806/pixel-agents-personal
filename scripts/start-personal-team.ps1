param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tsx = Join-Path $repo 'node_modules\.bin\tsx.cmd'
$webview = Join-Path $repo 'dist\webview\index.html'
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$desktopEntry = Join-Path $repo 'desktop\main.cjs'
if (-not (Test-Path $tsx) -or -not (Test-Path $webview)) {
    throw "Pixel Agents Personal не установлен. Запустите 'Install Pixel Agents Personal.cmd' в папке приложения."
}

if ((Test-Path $electron) -and (Test-Path $desktopEntry)) {
    Start-Process -FilePath $electron -ArgumentList $desktopEntry -WorkingDirectory $repo
    exit 0
}
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    Start-Process -FilePath $tsx -ArgumentList "server\src\cli.ts --port $Port" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repo 'pixel-agents-server.log') -RedirectStandardError (Join-Path $repo 'pixel-agents-server.error.log')
    Start-Sleep -Seconds 2
}

$edge = @("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=http://127.0.0.1:$Port" }
else { Start-Process "http://127.0.0.1:$Port" }
