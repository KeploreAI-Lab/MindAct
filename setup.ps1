# MindAct -- Windows one-shot setup
# Run: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
#      .\setup.ps1
param()
$ErrorActionPreference = "Stop"

function ok($msg)   { Write-Host "[OK]  $msg" -ForegroundColor Green }
function warn($msg) { Write-Host "[!!]  $msg" -ForegroundColor Yellow }
function die($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

Write-Host "======================================"
Write-Host "  MindAct -- Windows Setup"
Write-Host "======================================"

# -- 1. Visual Studio C++ Build Tools (node-pty) -----------------
Write-Host ""
Write-Host "Checking C++ build tools (required for Rust + node-pty)..."
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVS = $false
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vsPath) { $hasVS = $true }
}
if (-not $hasVS) {
    warn "C++ workload not found -- installing via vs_buildtools..."
    $vsBT = "$env:TEMP\vs_buildtools.exe"
    Write-Host "  Downloading Visual Studio Build Tools installer..."
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile $vsBT -UseBasicParsing
    Write-Host "  Installing C++ workload (this may take 5-10 minutes)..."
    $proc = Start-Process -FilePath $vsBT `
        -ArgumentList "--quiet","--wait","--norestart","--nocache",
                      "--add","Microsoft.VisualStudio.Workload.VCTools",
                      "--add","Microsoft.VisualStudio.Component.VC.Tools.ARM64",
                      "--add","Microsoft.VisualStudio.Component.Windows11SDK.22621",
                      "--includeRecommended" `
        -Wait -PassThru
    Write-Host "  Installer exited with code: $($proc.ExitCode)"
    # Re-check
    if (Test-Path $vswhere) {
        $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vsPath) { $hasVS = $true }
    }
    if (-not $hasVS) {
        Write-Host ""
        Write-Host "[ERR] C++ workload install failed (exit $($proc.ExitCode))." -ForegroundColor Red
        Write-Host "      Run the installer manually and add the C++ workload:" -ForegroundColor Yellow
        Write-Host "      $vsBT --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" -ForegroundColor Yellow
        exit 1
    }
    ok "C++ Build Tools with C++ workload installed"
} else {
    ok "C++ Build Tools found"
}

# Detect architecture -- on ARM64 we build an x64 binary (runs via Windows-on-ARM compat)
$isARM64 = ($env:PROCESSOR_ARCHITECTURE -eq "ARM64")
if ($isARM64) {
    Write-Host "  ARM64 machine detected -- will build x64 CLI (runs via WoA compatibility)"
    $script:cargoTarget = "x86_64-pc-windows-msvc"
} else {
    $script:cargoTarget = ""
}

# Load the full MSVC x64 build environment via vcvars64.bat
$vsInstallPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
if ($vsInstallPath) {
    $vcvars = "$vsInstallPath\VC\Auxiliary\Build\vcvars64.bat"
    if (Test-Path $vcvars) {
        $envDump = cmd /c "`"$vcvars`" && set" 2>$null
        foreach ($line in $envDump) {
            if ($line -match "^([^=]+)=(.*)$") {
                $k = $matches[1]; $v = $matches[2]
                [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
            }
        }
        ok "MSVC x64 environment loaded"
    } else {
        die "vcvars64.bat not found -- ensure C++ workload is installed"
    }
}

# -- 2. Rust ------------------------------------------------------
Write-Host ""
Write-Host "Checking Rust..."
$cargoBin = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoBin;$env:PATH"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    warn "Rust not found -- installing via rustup..."
    $rustupExe = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe -UseBasicParsing
    & $rustupExe -y --no-modify-path
    $env:PATH = "$cargoBin;$env:PATH"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        die "Rust install failed. Install manually: https://rustup.rs"
    }
    ok "Rust installed"
} else {
    ok "Rust $(cargo --version)"
}

# -- 3. Bun -------------------------------------------------------
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

# -- 4. Node.js ---------------------------------------------------
Write-Host ""
Write-Host "Checking Node.js..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    die "Node.js >=18 is required for node-pty. Install from https://nodejs.org"
}
$nodeVer = node -e "process.stdout.write(String(process.versions.node.split('.')[0]))"
if ([int]$nodeVer -lt 18) {
    die "Node.js >=18 required (found $(node --version)). Update at https://nodejs.org"
}
ok "Node.js $(node --version)"

# -- 5. Git submodule ---------------------------------------------
Write-Host ""
Write-Host "Initialising CLI submodule..."
git submodule update --init --recursive
ok "Submodule ready"

# -- 6. Build Rust CLI --------------------------------------------
Write-Host ""
Write-Host "Building physmind CLI..."
Push-Location cli\rust
if ($script:cargoTarget -ne "") {
    # Ensure the x64 target is installed in rustup
    rustup target add $script:cargoTarget
    cargo build --release --target $script:cargoTarget
    $cliBinSrc = "target\$script:cargoTarget\release\physmind.exe"
} else {
    cargo build --release
    $cliBinSrc = "target\release\physmind.exe"
}
Pop-Location

$cliBin = "cli\rust\$cliBinSrc"
if (-not (Test-Path $cliBin)) {
    die "CLI build failed -- physmind.exe not found at $cliBin"
}
ok "CLI built: $cliBin"

if (-not (Test-Path $cargoBin)) {
    New-Item -ItemType Directory -Path $cargoBin -Force | Out-Null
}
Copy-Item $cliBin "$cargoBin\physmind.exe" -Force
ok "physmind.exe copied to $cargoBin"

# -- 7. Root dependencies -----------------------------------------
Write-Host ""
Write-Host "Installing root dependencies..."
bun install
ok "Root dependencies installed"

# -- 8. Build client ----------------------------------------------
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
