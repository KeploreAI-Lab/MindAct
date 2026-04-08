#!/bin/bash
# MindAct — kill old, rebuild, restart everything

cd "$(dirname "${BASH_SOURCE[0]}")"

# Ensure Bun is resolvable in non-interactive shells.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if command -v bun >/dev/null 2>&1; then
  BUN_CMD="bun"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_CMD="$HOME/.bun/bin/bun"
else
  echo "❌ Bun not found. Install Bun first: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

echo "⏹  Stopping old processes..."
pkill -f "bun run server.ts" 2>/dev/null
pkill -f "bun.*server.ts" 2>/dev/null
pkill -f "physmind-app.*Electron" 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 1

echo "🔨 Building client..."
cd client && "$BUN_CMD" run build 2>&1 | tail -3
cd ..

echo "🚀 Starting server..."
"$BUN_CMD" run server.ts > /tmp/physmind-server.log 2>&1 &
SERVER_PID=$!

echo "   Waiting for server on port 3001..."
READY=0
for i in $(seq 1 10); do
  if lsof -ti:3001 > /dev/null 2>&1; then
    echo "   ✓ Server ready (pid $SERVER_PID)"
    READY=1
    break
  fi
  sleep 0.5
done
if [ "$READY" -ne 1 ]; then
  echo "❌ Server failed to start. See /tmp/physmind-server.log"
  exit 1
fi

echo "🖥  Launching Electron..."
env -u ELECTRON_RUN_AS_NODE \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  electron-main.cjs > /tmp/physmind-electron.log 2>&1 &

echo "✅ Done — app is running"
