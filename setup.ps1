# MindAct -- Windows one-shot setup
# Run: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
#      .\setup.ps1
param()
$ErrorActionPreference = "Stop"

function ok($msg)   { Write-Host "[OK]  $msg" -ForegroundColor Green }
function warn($msg) { Write-Host "[!!]  $msg" -ForegroundColor Yellow }
function die($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

$REPO = "KeploreAI-Lab/MindAct"

Write-Host "======================================"
Write-Host "  MindAct -- Windows Setup"
Write-Host "======================================"

# -- 1. Bun -------------------------------------------------------
Write-Host ""
Write-Host "Checking Bun..."
$bunBin = "$env:USERPROFILE\.bun\bin"
$env:PATH = "$bunBin;$env:PATH"

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    warn "Bun not found -- installing..."
    & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
    $env:PATH = "$bunBin;$env:PATH"
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        die "Bun install failed. Install manually: https://bun.sh"
    }
    ok "Bun installed"
} else {
    ok "Bun $(bun --version)"
}

# -- 2. Node.js ---------------------------------------------------
Write-Host ""
Write-Host "Checking Node.js..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    die "Node.js >=18 is required. Install from https://nodejs.org"
}
$nodeVer = node -e "process.stdout.write(String(process.versions.node.split('.')[0]))"
if ([int]$nodeVer -lt 18) {
    die "Node.js >=18 required (found $(node --version)). Update at https://nodejs.org"
}
ok "Node.js $(node --version)"

# -- 3. Download physmind.exe from GitHub Actions -----------------
Write-Host ""
Write-Host "Downloading physmind.exe (pre-built by GitHub CI)..."

$cargoBin = "$env:USERPROFILE\.cargo\bin"
if (-not (Test-Path $cargoBin)) {
    New-Item -ItemType Directory -Path $cargoBin -Force | Out-Null
}
$dest = "$cargoBin\physmind.exe"

# Get the latest successful workflow run artifact download URL
$headers = @{ "Accept" = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" }

try {
    $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/actions/runs?status=success&branch=main&per_page=5" -Headers $headers
    $runId = $null
    foreach ($run in $runs.workflow_runs) {
        if ($run.name -eq "Build CLI (Windows)") {
            $runId = $run.id
            break
        }
    }
    if (-not $runId) {
        # Try any successful run
        $runId = $runs.workflow_runs[0].id
    }

    $artifacts = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/actions/runs/$runId/artifacts" -Headers $headers
    $artifact = $artifacts.artifacts | Where-Object { $_.name -eq "physmind-windows-x64" } | Select-Object -First 1

    if ($artifact) {
        warn "GitHub artifact requires authentication to download directly."
        warn "Downloading via gh CLI if available, or direct release asset..."
    }
} catch {
    warn "Could not query GitHub API: $_"
}

# Simpler: download from releases if available, else guide user
$releaseUrl = "https://github.com/$REPO/releases/latest/download/physmind.exe"
Write-Host "  Trying latest release: $releaseUrl"
try {
    Invoke-WebRequest -Uri $releaseUrl -OutFile $dest -UseBasicParsing
    ok "physmind.exe downloaded to $dest"
} catch {
    warn "No release binary found yet."
    Write-Host ""
    Write-Host "  The physmind.exe is built automatically by GitHub Actions on every push."
    Write-Host "  To get it:"
    Write-Host "  1. Go to: https://github.com/$REPO/actions/workflows/build-cli.yml"
    Write-Host "  2. Click the latest successful run"
    Write-Host "  3. Download the 'physmind-windows-x64' artifact"
    Write-Host "  4. Extract physmind.exe to: $cargoBin"
    Write-Host "  5. Re-run this script"
    Write-Host ""
    $skip = Read-Host "Press Enter to continue setup without CLI (you can add it later), or Ctrl+C to abort"
}

# -- 4. Git submodule ---------------------------------------------
Write-Host ""
Write-Host "Initialising submodule..."
git submodule update --init --recursive
ok "Submodule ready"

# -- 5. Root dependencies -----------------------------------------
Write-Host ""
Write-Host "Installing root dependencies..."
bun install
ok "Root dependencies installed"

# -- 6. Build client ----------------------------------------------
Write-Host ""
Write-Host "Building client..."
Push-Location client
bun install
bun run build
Pop-Location
ok "Client built"

# -- Done ---------------------------------------------------------
Write-Host ""
Write-Host "======================================"
ok "Setup complete!"
Write-Host ""
Write-Host "  Launch the app:  .\restart.ps1"
Write-Host "======================================"
