'use strict';
const { app, BrowserWindow, session, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ── 打包环境检测 ──────────────────────────────────────────────────────────────
const IS_PACKAGED = app.isPackaged;

// Linux sandbox
if (process.platform === 'linux' && (process.env.MINDACT_ELECTRON_NO_SANDBOX === '1' || IS_PACKAGED)) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

// ── app:// 协议注册（必须在 app.ready 前调用）────────────────────────────────
// 打包后用 app://mindact/ 直接从 resourcesPath/client/dist 提供静态文件，
// 同时将 /api /auth 请求代理到 bun server。
// 这样不依赖 bun server 找到 client/dist，彻底解决 Windows 路径问题。
if (IS_PACKAGED) {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: {
      secure: true,          // 视为 HTTPS 安全上下文
      standard: true,        // 标准 URL 解析
      supportFetchAPI: true, // 允许 fetch()
      corsEnabled: false,    // 不限制跨源（API 请求到 localhost:3001）
      stream: true,          // 支持 SSE / 流式响应
    },
  }]);
}

// ── MIME 类型映射 ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.eot':  'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
};

function getMime(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// ── app:// 协议处理器 ─────────────────────────────────────────────────────────
function setupAppProtocol() {
  const distDir = path.join(process.resourcesPath, 'client', 'dist');

  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;  // e.g. "/api/config"

    // ── API / Auth → 代理到 bun server ────────────────────────────────────────
    if (pathname.startsWith('/api') || pathname.startsWith('/auth') || pathname.startsWith('/ws')) {
      const serverUrl = 'http://localhost:3001' + pathname + url.search;
      try {
        const hasBody = !['GET', 'HEAD'].includes(request.method.toUpperCase());
        const init = { method: request.method, headers: Object.fromEntries(request.headers) };
        if (hasBody && request.body) {
          init.body = await request.arrayBuffer();
        }
        return await net.fetch(serverUrl, init);
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ── 静态文件 → 从 client/dist 直接读取 ────────────────────────────────────
    let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    let filePath = path.join(distDir, rel);

    // SPA fallback：不存在的路径返回 index.html
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      filePath = path.join(distDir, 'index.html');
    }

    try {
      const body = fs.readFileSync(filePath);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': getMime(filePath) },
      });
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ── Server 子进程管理 ─────────────────────────────────────────────────────────
let serverProcess = null;

function startServer() {
  if (!IS_PACKAGED) {
    console.log('[electron] Dev mode — using external bun server on :3001');
    return;
  }

  const serverBinName = process.platform === 'win32' ? 'mindact-server.exe' : 'mindact-server';
  const serverBin = path.join(process.resourcesPath, serverBinName);
  const env = {
    ...process.env,
    NODE_BINARY: process.execPath,
    // ELECTRON_AS_NODE=1 lets the server spawn pty-worker.cjs using
    // ELECTRON_RUN_AS_NODE=1 <electron-binary>, so we don't need a
    // separate Node.js installation on the user's machine.
    ELECTRON_AS_NODE: '1',
    MINDACT_RESOURCES: process.resourcesPath,
  };

  console.log('[electron] Starting server:', serverBin);
  serverProcess = spawn(serverBin, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  serverProcess.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on('exit', (code) => {
    console.log(`[electron] Server exited with code ${code}`);
    serverProcess = null;
  });
}

async function waitForServer(maxRetries = 30, intervalMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch('http://localhost:3001/api/config');
      if (res.ok || res.status === 500) return;
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('MindAct server failed to start in time');
}

// ── 启动 Splash 屏 ────────────────────────────────────────────────────────────
let splashWindow = null;

function showSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    height: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    -webkit-app-region: drag;
  }
  .top-bar {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
    background: linear-gradient(90deg, #3B82F6, #60A5FA);
    border-radius: 8px 8px 0 0;
  }
  .logo-row { display: flex; align-items: center; gap: 10px; }
  .dot {
    width: 36px; height: 36px;
    border-radius: 8px;
    background: #3B82F6;
    display: flex; align-items: center; justify-content: center;
  }
  .dot svg { width: 22px; height: 22px; fill: white; }
  h1 { font-size: 22px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px; }
  .status { font-size: 13px; color: #64748b; }
  .spinner {
    width: 28px; height: 28px;
    border: 2.5px solid #e2e8f0;
    border-top-color: #3B82F6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="top-bar"></div>
  <div class="logo-row">
    <div class="dot">
      <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
    </div>
    <h1>MindAct</h1>
  </div>
  <div class="spinner"></div>
  <div class="status">Starting server\u2026</div>
</body>
</html>`;

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  splashWindow.on('closed', () => { splashWindow = null; });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ── 窗口管理 ──────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'MindAct',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // CSP：允许 WebSocket 连接和 eval（xterm.js / CodeMirror 需要）
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src * ws: wss:;"
        ],
      },
    });
  });

  // 打包模式：从 app://mindact/ 加载（直接读取 client/dist，不依赖 server 找到文件）
  // 开发模式：从 bun server + Vite 开发服务器加载
  if (IS_PACKAGED) {
    win.loadURL('app://mindact/');
  } else {
    win.loadURL('http://localhost:3001');
  }

  win.on('closed', () => { app.quit(); });
}

// ── 自动更新 ──────────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!IS_PACKAGED) {
    console.log('[updater] Dev mode — auto-update disabled');
    return;
  }

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('[updater] electron-updater not available:', e.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => console.log('[updater] Checking for updates...'));
  autoUpdater.on('update-available', (info) => console.log(`[updater] Update available: v${info.version}`));
  autoUpdater.on('update-not-available', () => console.log('[updater] Up to date.'));
  autoUpdater.on('error', (err) => console.error('[updater] Error:', err.message));
  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] Downloading: ${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: v${info.version}`);
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('update-downloaded', { version: info.version });
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => console.error('[updater] Check failed:', e.message));
  }, 10_000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(e => console.error('[updater] Check failed:', e.message));
  }, 4 * 60 * 60 * 1000);
}

// ── 单实例锁（防止 Windows 上重复打开窗口）────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 已有实例运行，直接退出
  app.quit();
} else {
  app.on('second-instance', () => {
    // 有人尝试启动第二个实例 → 聚焦已有窗口
    const win = BrowserWindow.getAllWindows().find(w => w !== splashWindow);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
app.on('ready', async () => {
  // 注册 app:// 协议处理器（打包模式）
  if (IS_PACKAGED) {
    setupAppProtocol();
  }

  // IPC：原生目录选择器
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, options);
    return result;
  });

  // IPC：安装更新并重启
  ipcMain.handle('install-update', () => {
    let autoUpdater;
    try { autoUpdater = require('electron-updater').autoUpdater; } catch { return; }
    autoUpdater.quitAndInstall(false, true);
  });

  // Splash 屏
  showSplash();

  // 启动 bun server
  startServer();

  try {
    await waitForServer();
  } catch (err) {
    closeSplash();
    dialog.showErrorBox('启动失败', '无法连接 MindAct 服务器，请重新打开应用。\n\n如问题持续出现，请尝试重新安装。');
    app.quit();
    return;
  }

  createWindow();
  const mainWin = BrowserWindow.getAllWindows().find(w => w !== splashWindow);
  if (mainWin) {
    mainWin.webContents.once('did-finish-load', () => closeSplash());
    setTimeout(() => closeSplash(), 4000);
  } else {
    closeSplash();
  }

  setupAutoUpdater();
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
    serverProcess = null;
  }
});
