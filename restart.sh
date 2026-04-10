#!/bin/bash
# MindAct — stop old processes, rebuild client, start server (+ optional Electron)
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

# ── Desktop shell (Electron, optional) ────────────────────────
SKIP_ELECTRON=0
if [ "${MINDACT_SKIP_ELECTRON:-}" = "1" ]; then
  SKIP_ELECTRON=1
  echo "🌐   Electron skipped (MINDACT_SKIP_ELECTRON=1 — browser UI: 3001 + Vite 5173)."
else
  echo "🖥   Electron (desktop window, optional)..."
fi

if [ "$SKIP_ELECTRON" -eq 0 ] && [ "$(uname -s)" = "Linux" ] && [ -f "scripts/check-linux-electron.sh" ]; then
  if ! bash scripts/check-linux-electron.sh; then
    SKIP_ELECTRON=1
  fi
fi

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

ELECTRON=""
if [ "$SKIP_ELECTRON" -eq 0 ]; then
  ELECTRON="$(find_electron)"
  if [ -z "$ELECTRON" ]; then
    echo "❌  Electron not found. Run ./setup.sh first."
    exit 1
  fi
fi

# Chromium SUID sandbox on Linux: chrome-sandbox must be root-owned + setuid (4755) or Electron aborts.
CHROME_SANDBOX="node_modules/electron/dist/chrome-sandbox"
if [ "$SKIP_ELECTRON" -eq 0 ] && [ "$(uname -s)" = "Linux" ] && [ -f "$CHROME_SANDBOX" ]; then
  _sb_uid=$(stat -c '%u' "$CHROME_SANDBOX" 2>/dev/null || echo 1)
  if [ "$_sb_uid" != "0" ] || ! [ -u "$CHROME_SANDBOX" ]; then
    export MINDACT_ELECTRON_NO_SANDBOX=1
  fi
fi

if [ "$SKIP_ELECTRON" -eq 0 ] && [ "${MINDACT_ELECTRON_NO_SANDBOX:-}" = "1" ]; then
  echo "⚠️   Electron will use --no-sandbox (chrome-sandbox is not root setuid; typical under node_modules)."
  echo "    Optional harden: sudo chown root:root $CHROME_SANDBOX && sudo chmod 4755 $CHROME_SANDBOX"
fi

if [ "$SKIP_ELECTRON" -eq 1 ]; then
  if [ "${MINDACT_SKIP_ELECTRON:-}" != "1" ]; then
    echo "⚠️   Electron skipped (GTK/Chromium libraries missing — see check-linux-electron.sh above)."
  fi
  echo "    API + static UI:  http://localhost:3001"
  echo "    Dev UI (proxy):   cd client && bun run dev  →  http://localhost:5173"
elif [ "$ELECTRON" = "npx" ]; then
  env -u ELECTRON_RUN_AS_NODE \
    npx electron electron-main.cjs > /tmp/mindact-electron.log 2>&1 &
  ELECTRON_PID=$!
else
  env -u ELECTRON_RUN_AS_NODE \
    "$ELECTRON" electron-main.cjs > /tmp/mindact-electron.log 2>&1 &
  ELECTRON_PID=$!
fi
# Note: ELECTRON_PID may be a wrapper (npx); crash detection relies on log grep below.

echo "✅  MindAct server is running"
echo "    Server log:   /tmp/mindact-server.log"
if [ "$SKIP_ELECTRON" -eq 0 ]; then
  echo "    Electron log: /tmp/mindact-electron.log"
  sleep 2
  if [ -f /tmp/mindact-electron.log ] && grep -q "error while loading shared libraries" /tmp/mindact-electron.log 2>/dev/null; then
    echo ""
    echo "❌  Electron exited immediately (library error). Last lines:"
    tail -3 /tmp/mindact-electron.log
    echo "    Run:  bash scripts/check-linux-electron.sh"
  elif [ -f /tmp/mindact-electron.log ] && grep -q "setuid_sandbox_host" /tmp/mindact-electron.log 2>/dev/null; then
    echo ""
    echo "❌  Electron SUID sandbox error. ./restart.sh sets MINDACT_ELECTRON_NO_SANDBOX when needed;"
    echo "    manual start: export MINDACT_ELECTRON_NO_SANDBOX=1  (see README → Troubleshooting)."
    tail -3 /tmp/mindact-electron.log
  elif [ -f /tmp/mindact-electron.log ] && grep -q "Missing X server" /tmp/mindact-electron.log 2>/dev/null; then
    echo ""
    echo "❌  Electron needs a display. Use:  MINDACT_SKIP_ELECTRON=1 ./restart.sh  then  cd client && bun run dev"
    tail -3 /tmp/mindact-electron.log
  elif [ -n "${ELECTRON_PID:-}" ] && ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    echo ""
    echo "⚠️  Electron process ended quickly. Check:  /tmp/mindact-electron.log"
    [ -f /tmp/mindact-electron.log ] && tail -5 /tmp/mindact-electron.log
  fi
fi
