#!/bin/bash
# Launch PhysMind as a desktop app using Electron
# Unsets ELECTRON_RUN_AS_NODE which is set by Bun/Node environment and breaks Electron's main process

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON="$SCRIPT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [ ! -f "$ELECTRON" ]; then
  echo "Electron not found at $ELECTRON"
  echo "Run: npm install electron --save-dev"
  exit 1
fi

echo "Launching PhysMind desktop app..."
exec env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$SCRIPT_DIR/electron-main.cjs" "$@"
