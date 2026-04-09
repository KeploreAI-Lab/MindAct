# MindAct -- Windows launcher
# Run: .\restart.ps1
param()
$ErrorActionPreference = "SilentlyContinue"

function ok($msg)  { Write-Host "[OK]  $msg" -ForegroundColor Green }
function die($msg) { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Add Bun and cargo to PATH for this session
$env:PATH = "$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"

Write-Host "Stopping old processes..."

# Kill anything on port 3001
$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $pids = $conn | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
}
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 800

# -- Build client -------------------------------------------------
Write-Host ""
Write-Host "Building client..."
Push-Location client
bun run build 2>&1 | Select-Object -Last 3
Pop-Location

# -- Start server -------------------------------------------------
Write-Host ""
Write-Host "Starting server..."
$serverLog = "$env:TEMP\mindact-server.log"
$serverJob = Start-Process -FilePath "bun" `
    -ArgumentList "run", "server.ts" `
    -WorkingDirectory $ScriptDir `
    -RedirectStandardOutput $serverLog `
    -RedirectStandardError "$env:TEMP\mindact-server-err.log" `
    -NoNewWindow -PassThru

# Wait for port 3001
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    $conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $ready = $true; break }
}
if (-not $ready) {
    Write-Host "Server log:" -ForegroundColor Red
    Get-Content $serverLog -ErrorAction SilentlyContinue | Select-Object -Last 20
    die "Server failed to start. See $serverLog"
}
ok "Server ready (pid $($serverJob.Id))"

# -- Launch Electron ----------------------------------------------
Write-Host ""
Write-Host "Launching Electron..."
$electronExe = "$ScriptDir\node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    die "Electron not found at $electronExe -- did you run setup.ps1?"
}
Start-Process -FilePath $electronExe -ArgumentList "electron-main.cjs" -WorkingDirectory $ScriptDir

ok "Done -- MindAct is running"
