# MindAct — Windows one-shot setup
# Run from PowerShell: .\setup.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ok($msg)   { Write-Host "✅  $msg" -ForegroundColor Green }
function warn($msg) { Write-Host "⚠️   $msg" -ForegroundColor Yellow }
function die($msg)  { Write-Host "❌  $msg" -ForegroundColor Red; exit 1 }

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  MindAct — Windows Setup"
Write-Host "======================================"

# ── 1. Visual Studio Build Tools (node-pty needs C++ compiler) ──
Write-Host "`n🔧  Checking C++ build tools..."
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVS = $false
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vsPath) { $hasVS = $true }
}
if (-not $hasVS) {
    warn "Visual Studio C++ Build Tools not found."
    Write-Host "  node-pty requires them. Install from:"
    Write-Host "  https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    Write-Host "  (Choose 'Desktop development with C++')"
    Write-Host ""
    $ans = Read-Host "  Press Enter to continue anyway, or Ctrl+C to abort"
} else {
    ok "C++ Build Tools found"
}

# ── 2. Rust ──────────────────────────────────────────────────────
Write-Host "`n🦀  Checking Rust..."
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    warn "Rust not found — installing via rustup..."
    $rustupUrl = "https://win.rustup.rs/x86_64"
    $rustupExe = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupExe
    & $rustupExe -y --no-modify-path
    # Add cargo to PATH for this session
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        die "Rust install failed. Please install manually: https://rustup.rs"
    }
    ok "Rust installed"
} else {
    ok "Rust $(cargo --version)"
}

# ── 3. Bun ───────────────────────────────────────────────────────
Write-Host "`n📦  Checking Bun..."
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    warn "Bun not found — installing..."
    powershell -c "irm bun.sh/install.ps1 | iex"
    # Refresh PATH
    $env:PATH = "$env:USERPROFILE\.bun\bin;$env:PATH"
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        die "Bun install failed. Please install manually: https://bun.sh"
    }
    ok "Bun installed"
} else {
    ok "Bun $(bun --version)"
}

# ── 4. Node.js (required for node-pty) ───────────────────────────
Write-Host "`n📦  Checking Node.js..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    die "Node.js >=18 is required for node-pty. Install from https://nodejs.org"
}
$nodeVersion = node -e "process.stdout.write(String(process.versions.node.split('.')[0]))"
if ([int]$nodeVersion -lt 18) {
    die "Node.js >=18 required (found $(node --version)). Update at https://nodejs.org"
}
ok "Node.js $(node --version)"

# ── 5. Git submodule (CLI) ────────────────────────────────────────
Write-Host "`n📦  Initialising CLI submodule..."
git submodule update --init --recursive
ok "Submodule ready"

# ── 6. Build Rust CLI ─────────────────────────────────────────────
Write-Host "`n🦀  Building physmind CLI..."
Push-Location cli\rust
cargo build --release
Pop-Location
$cliBin = "cli\rust\target\release\physmind.exe"
if (-not (Test-Path $cliBin)) {
    die "CLI build failed — physmind.exe not found"
}
ok "CLI built: $cliBin"

# Copy to .cargo\bin so it's on PATH
$cargoBin = "$env:USERPROFILE\.cargo\bin"
Copy-Item $cliBin "$cargoBin\physmind.exe" -Force
ok "physmind.exe → $cargoBin\physmind.exe"

# ── 7. Install app dependencies ───────────────────────────────────
Write-Host "`n📦  Installing root dependencies..."
bun install
ok "Root dependencies installed"

# ── 8. Build client ───────────────────────────────────────────────
Write-Host "`n🔨  Building client..."
Push-Location client
bun install
bun run build
Pop-Location
ok "Client built → client/dist/"

# ── Done ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
ok "Setup complete!"
Write-Host ""
Write-Host "  Launch the app:  .\restart.ps1"
Write-Host "======================================"
