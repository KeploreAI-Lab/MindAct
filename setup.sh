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

# ── 4. Install & build client ────────────────────────────────
echo ""
echo "🔨  Building client..."
cd client
bun install
bun run build
cd ..
ok "Client built -> client/dist/"

# ── 5. Claude CLI check ───────────────────────────────────────
echo ""
echo "🔍  Checking for Claude CLI..."
CLAUDE_FOUND=""
for candidate in \
    "${CLAUDE_BIN:-}" \
    "$HOME/claw-code/rust/target/release/claw" \
    "$HOME/.local/bin/claude" \
    "$HOME/.npm-global/bin/claude" \
    "/usr/local/bin/claude" \
    "/opt/homebrew/bin/claude" \
    "$(command -v claude 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    CLAUDE_FOUND="$candidate"
    break
  fi
done

if [ -n "$CLAUDE_FOUND" ]; then
  ok "CLI found: $CLAUDE_FOUND"
else
  warn "Claude CLI not found. Install it with:"
  echo "      npm install -g @anthropic-ai/claude-code"
  echo ""
  echo "  MindAct will still launch — enter your kplr-... key in Settings"
  echo "  and the CLI will be detected automatically once installed."
fi

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "======================================"
ok "Setup complete!"
echo ""
echo "  Launch the app:  ./restart.sh"
echo "======================================"
