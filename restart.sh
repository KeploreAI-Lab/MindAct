#!/bin/bash
# MindAct — kill old, rebuild, restart everything

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "⏹  Stopping old processes..."
pkill -f "bun run server.ts" 2>/dev/null
pkill -f "bun.*server.ts" 2>/dev/null
pkill -f "physmind-app.*Electron" 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 1

echo "🔨 Building client..."
cd client && bun run build 2>&1 | tail -3
cd ..

echo "🚀 Starting server..."
bun run server.ts > /tmp/physmind-server.log 2>&1 &
SERVER_PID=$!

echo "   Waiting for server on port 3001..."
for i in $(seq 1 10); do
  if lsof -ti:3001 > /dev/null 2>&1; then
    echo "   ✓ Server ready (pid $SERVER_PID)"
    break
  fi
  sleep 0.5
done

echo "🖥  Launching Electron..."
env -u ELECTRON_RUN_AS_NODE \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  electron-main.cjs > /tmp/physmind-electron.log 2>&1 &

echo "✅ Done — app is running"
