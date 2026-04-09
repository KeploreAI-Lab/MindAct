#!/bin/bash
# MindAct — one-shot setup: CLI (Rust) + app (Bun/Electron)
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
die()  { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo "======================================"
echo "  MindAct Setup"
echo "======================================"

# ── 1. Submodule ──────────────────────────────────────────────
echo ""
echo "📦 Initialising CLI submodule..."
git submodule update --init --recursive
ok "Submodule ready"

# ── 2. Build CLI (Rust) ───────────────────────────────────────
echo ""
echo "🦀 Building physmind CLI (Rust)..."
if ! command -v cargo &>/dev/null; then
  die "cargo not found. Install Rust: https://rustup.rs"
fi

cd cli/rust
cargo build --release 2>&1 | tail -5
CLI_BIN="$(pwd)/target/release/physmind"
if [ ! -f "$CLI_BIN" ]; then
  die "Build failed — binary not found at $CLI_BIN"
fi
ok "CLI built: $CLI_BIN"
cd ../..

# Link binary so it's on PATH
LINK_TARGET="/usr/local/bin/physmind"
if [ -w "/usr/local/bin" ] || sudo -n true 2>/dev/null; then
  sudo ln -sf "$CLI_BIN" "$LINK_TARGET"
  ok "Linked → $LINK_TARGET"
else
  warn "Could not link to /usr/local/bin (no sudo). Add this to your shell profile:"
  echo "    export PATH=\"$(pwd)/cli/rust/target/release:\$PATH\""
fi

# ── 3. Install app dependencies (Bun) ────────────────────────
echo ""
echo "📦 Installing app dependencies..."
if command -v bun &>/dev/null; then
  bun install
  ok "Dependencies installed (Bun)"
elif command -v npm &>/dev/null; then
  npm install
  ok "Dependencies installed (npm)"
else
  die "Neither bun nor npm found."
fi

# ── 4. Done ───────────────────────────────────────────────────
echo ""
echo "======================================"
ok "Setup complete!"
echo ""
echo "  Start the app:  ./restart.sh"
echo "  CLI binary:     $CLI_BIN"
echo "======================================"
