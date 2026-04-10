#!/bin/bash
# MindAct — one-shot setup
# Usage: ./setup.sh
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
die()  { echo -e "${RED}❌  $1${NC}"; exit 1; }

echo "======================================"
echo "  MindAct — Setup"
echo "======================================"

# ── 1. Bun ────────────────────────────────────────────────────
echo ""
echo "📦  Checking Bun..."
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun &>/dev/null; then
  warn "Bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun &>/dev/null || die "Bun install failed. Visit https://bun.sh"
fi
ok "Bun $(bun --version)"

# ── 2. Node.js (required for node-pty native addon) ──────────
echo ""
echo "📦  Checking Node.js..."
if ! command -v node &>/dev/null; then
  die "Node.js >=18 is required (for node-pty). Install from https://nodejs.org"
fi
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js >=18 required (found $(node --version)). Update at https://nodejs.org"
fi
ok "Node.js $(node --version)"

# ── 3. Install root dependencies ─────────────────────────────
echo ""
echo "📦  Installing root dependencies..."
bun install
ok "Root dependencies installed"

# ── 3a. Linux: node-pty native addon (often no linux prebuild in the package) ──
if [ "$(uname -s)" = "Linux" ]; then
  if ! node -e "require('./node_modules/node-pty')" 2>/dev/null; then
    warn "Building node-pty for Linux (in-app terminal)..."
    if (cd node_modules/node-pty && npx --yes node-gyp@10 rebuild); then
      if node -e "require('./node_modules/node-pty')" 2>/dev/null; then
        ok "node-pty native module OK"
      else
        warn "node-pty still fails to load after rebuild"
      fi
    else
      warn "node-gyp rebuild failed — install build-essential; terminal may exit immediately (see README Troubleshooting)"
    fi
  fi
fi

# ── 3b. Linux: GTK/Chromium libs for Electron desktop ────────
echo ""
echo "🖥   Checking Electron system libraries (Linux)..."
if [ "$(uname -s)" = "Linux" ] && [ -f "scripts/check-linux-electron.sh" ]; then
  if bash scripts/check-linux-electron.sh; then
    ok "Electron system libraries OK"
  else
    warn "./restart.sh will skip the desktop window until you install them (browser UI still works)."
  fi
fi

# ── 4. Install & build client ────────────────────────────────
echo ""
echo "🔨  Building client..."
cd client
bun install
bun run build
cd ..
ok "Client built -> client/dist/"

# ── 5. Build CLI (Rust) — git submodule: physmind-cli-rust ───
echo ""
echo "🦀  Building CLI..."
if [ ! -f "cli/rust/Cargo.toml" ]; then
  echo ""
  die "Rust CLI is missing. It lives in a separate repo linked as a git submodule.

  From this directory, run:

    git submodule update --init --recursive

  (Or clone MindAct with:  git clone --recurse-submodules <MindAct-repo-url>)

  Submodule: https://github.com/KeploreAI-Lab/physmind-cli-rust
  Expected path: cli/rust/Cargo.toml

  Then re-run:  ./setup.sh"
fi
if ! command -v cargo &>/dev/null; then
  warn "Rust not found — installing via rustup..."
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path
  source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
  command -v cargo &>/dev/null || die "Rust install failed. Visit https://rustup.rs"
  ok "Rust installed ($(cargo --version))"
fi
(cd cli/rust && cargo build --release 2>&1 | tail -3)
CLI_BIN="$(pwd)/cli/rust/target/release/physmind"
[ -f "$CLI_BIN" ] || die "CLI build failed — binary not found at $CLI_BIN"
ok "CLI built: $CLI_BIN"

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "======================================"
ok "Setup complete!"
echo ""
echo "  Launch the app:  ./restart.sh"
echo "======================================"
