#!/bin/bash
# prebuild.sh — 在 electron-builder 打包前执行：
#   1. 构建 React 前端 (Vite → client/dist/)
#   2. 编译 Bun 服务端到单一可执行文件 (mindact-server)
#
# 用法：
#   bash scripts/prebuild.sh            # 本地手动执行
#   (electron-builder 会在打包前自动调用)
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── 确认 bun 可用 ──────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "❌  bun not found. Install from https://bun.sh"
  exit 1
fi

# ── 1. 构建前端 ────────────────────────────────────────────────
echo "🔨  Building React frontend (Vite)..."
cd "$ROOT/client"
bun install --frozen-lockfile 2>/dev/null || bun install
bun run build
cd "$ROOT"
echo "    ✓ client/dist/ ready"

# ── 2. 编译服务端为独立可执行文件 ─────────────────────────────
echo "⚙️   Compiling server.ts → mindact-server..."
# --compile 将 Bun runtime + 所有 TS/JS 模块打包进单一二进制
# node-pty 在 pty-worker.cjs (独立 Node.js 进程) 中，不影响编译
bun build --compile server.ts --outfile mindact-server
echo "    ✓ mindact-server ready ($(du -sh mindact-server | cut -f1))"

echo "✅  Prebuild complete."
