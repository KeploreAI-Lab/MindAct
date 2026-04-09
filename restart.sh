#!/bin/bash
# MindAct — stop old processes, rebuild client, start server + Electron
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

# Ensure Bun is on PATH in non-interactive shells
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if command -v bun &>/dev/null; then
  BUN_CMD="bun"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_CMD="$HOME/.bun/bin/bun"
else
  echo "❌  Bun not found. Run ./setup.sh first."
  exit 1
fi

# ── Stop old processes ────────────────────────────────────────
echo "⏹   Stopping old processes..."
pkill -f "bun run server.ts"   2>/dev/null || true
pkill -f "bun.*server.ts"      2>/dev/null || true
pkill -f "MindAct.*Electron"   2>/dev/null || true
pkill -f "Electron.*electron-main" 2>/dev/null || true
lsof -ti:3001 | xargs kill -9  2>/dev/null || true
sleep 0.5

# ── Build client (fast — Vite only rebuilds changed files) ───
echo "🔨  Building client..."
cd client && "$BUN_CMD" run build 2>&1 | tail -3 && cd ..

# ── Start server ──────────────────────────────────────────────
echo "🚀  Starting server..."
# Resolve CLI binary: prefer project-local build, fall back to ~/claw-code
if [ -z "${CLAUDE_BIN:-}" ]; then
  for _candidate in \
      "$(pwd)/cli/rust/target/release/physmind" \
      "$HOME/claw-code/rust/target/release/claw" \
      "$HOME/claw-code/rust/target/release/physmind"; do
    if [ -x "$_candidate" ]; then
      CLAUDE_BIN="$_candidate"
      break
    fi
  done
fi
export CLAUDE_BIN
"$BUN_CMD" run server.ts > /tmp/mindact-server.log 2>&1 &
SERVER_PID=$!

echo "    Waiting for server on :3001..."
for i in $(seq 1 20); do
  if lsof -ti:3001 > /dev/null 2>&1; then
    echo "    ✓ Server ready (pid $SERVER_PID)"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "❌  Server failed to start. Check /tmp/mindact-server.log"
    exit 1
  fi
  sleep 0.5
done

# ── Launch Electron ───────────────────────────────────────────
echo "🖥   Launching Electron..."

# Resolve electron binary (works on macOS, Linux, and Windows/WSL)
find_electron() {
  # 1. npx/bunx electron (most portable)
  if command -v npx &>/dev/null; then
    echo "npx"
    return
  fi
  # 2. macOS app bundle
  local mac_bin="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  if [ -x "$mac_bin" ]; then echo "$mac_bin"; return; fi
  # 3. Linux binary
  local linux_bin="node_modules/electron/dist/electron"
  if [ -x "$linux_bin" ]; then echo "$linux_bin"; return; fi
  # 4. node_modules/.bin/electron
  local npm_bin="node_modules/.bin/electron"
  if [ -x "$npm_bin" ]; then echo "$npm_bin"; return; fi
  echo ""
}

ELECTRON="$(find_electron)"
if [ -z "$ELECTRON" ]; then
  echo "❌  Electron not found. Run ./setup.sh first."
  exit 1
fi

if [ "$ELECTRON" = "npx" ]; then
  env -u ELECTRON_RUN_AS_NODE \
    npx electron electron-main.cjs > /tmp/mindact-electron.log 2>&1 &
else
  env -u ELECTRON_RUN_AS_NODE \
    "$ELECTRON" electron-main.cjs > /tmp/mindact-electron.log 2>&1 &
fi

echo "✅  MindAct is running"
echo "    Server log:   /tmp/mindact-server.log"
echo "    Electron log: /tmp/mindact-electron.log"
