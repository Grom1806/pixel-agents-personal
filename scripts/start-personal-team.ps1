param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tsx = Join-Path $repo 'node_modules\.bin\tsx.cmd'
$webview = Join-Path $repo 'dist\webview\index.html'
if (-not (Test-Path $tsx) -or -not (Test-Path $webview)) {
    throw "Pixel Agents Personal не установлен. Запустите 'Install Pixel Agents Personal.cmd' в папке приложения."
}
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    Start-Process -FilePath $tsx -ArgumentList "server\src\cli.ts --port $Port" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repo 'pixel-agents-server.log') -RedirectStandardError (Join-Path $repo 'pixel-agents-server.error.log')
    Start-Sleep -Seconds 2
}

$edge = @("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=http://127.0.0.1:$Port" }
else { Start-Process "http://127.0.0.1:$Port" }
