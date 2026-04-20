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
  let appVersion = 'unknown';
  try {
    const pkgPath = IS_PACKAGED
      ? path.join(process.resourcesPath, 'package.json')
      : path.join(__dirname, 'package.json');
    appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version ?? 'unknown';
  } catch {}

  splashWindow = new BrowserWindow({
    width: 540,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    transparent: true,
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
  html, body { width: 540px; height: 320px; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0c1222;
    border: 1px solid #1e3a5f;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    -webkit-app-region: drag;
    animation: fadeIn 0.25s ease-in;
    position: relative;
    overflow: hidden;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  /* Subtle background glow */
  .glow {
    position: absolute;
    top: -80px; left: 50%; transform: translateX(-50%);
    width: 360px; height: 240px;
    background: radial-gradient(ellipse at center, rgba(59,130,246,0.18) 0%, transparent 70%);
    pointer-events: none;
  }

  /* Icon */
  .icon-wrap {
    width: 64px; height: 64px; border-radius: 16px;
    background: linear-gradient(135deg, #1e40af, #3b82f6);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 18px;
    box-shadow: 0 0 32px rgba(59,130,246,0.35);
  }
  .icon-wrap svg { width: 36px; height: 36px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

  /* Title */
  .title { font-size: 30px; font-weight: 800; color: #f1f5f9; letter-spacing: -1px; margin-bottom: 6px; }
  .subtitle { font-size: 12px; color: #475569; letter-spacing: 0.5px; margin-bottom: 32px; }

  /* Progress bar */
  .progress-track {
    width: 240px; height: 2px; background: #1e293b; border-radius: 2px; overflow: hidden;
    position: relative;
  }
  .progress-fill {
    height: 100%; width: 0;
    background: linear-gradient(90deg, #3b82f6, #60a5fa);
    border-radius: 2px;
    animation: progress 4s cubic-bezier(0.4,0,0.2,1) forwards;
  }
  @keyframes progress { 0%{width:0} 60%{width:70%} 85%{width:88%} 100%{width:96%} }

  .status { font-size: 11px; color: #334155; margin-top: 10px; }

  /* Bottom copyright */
  .copyright {
    position: absolute; bottom: 14px; right: 20px;
    font-size: 10px; color: #1e293b; letter-spacing: 0.3px;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="icon-wrap">
    <svg viewBox="0 0 24 24">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
  </div>
  <div class="title">MindAct</div>
  <div class="subtitle">AI Decision Intelligence &nbsp;·&nbsp; v${appVersion}</div>
  <div class="progress-track">
    <div class="progress-fill"></div>
  </div>
  <div class="status">Starting server\u2026</div>
  <div class="copyright">&copy; 2024 KeploreAI</div>
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
  // Install silently when the user next quits the app — no reinstall wizard shown.
  autoUpdater.autoInstallOnAppQuit = true;

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
    // isSilent=true → NSIS runs with /S (no wizard); isForceRunAfter=true → restart after install
    autoUpdater.quitAndInstall(true, true);
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

  // ── 应用菜单（Windows / Linux 显示菜单栏；macOS 自动出现在系统菜单栏）─────────
  {
    const { Menu, shell } = require('electron');
    let appVersion = 'unknown';
    try {
      const pkgPath = IS_PACKAGED
        ? path.join(process.resourcesPath, 'package.json')
        : path.join(__dirname, 'package.json');
      appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version ?? 'unknown';
    } catch {}

    const send = (event, data) => {
      const w = BrowserWindow.getAllWindows().find(win => win !== splashWindow);
      if (w) w.webContents.send('menu-event', event, data);
    };

    const menuTemplate = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Project…',
            accelerator: 'CmdOrCtrl+O',
            click: async () => {
              const win = BrowserWindow.getFocusedWindow() || mainWin;
              const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open Project' });
              if (!result.canceled && result.filePaths[0]) send('menu-open-project', result.filePaths[0]);
            },
          },
          {
            label: 'Import Skill…',
            click: async () => {
              const win = BrowserWindow.getFocusedWindow() || mainWin;
              const result = await dialog.showOpenDialog(win, {
                title: 'Import Skill',
                filters: [{ name: 'Skill', extensions: ['skill', 'zip', 'yaml', 'yml', 'md'] }],
                properties: ['openFile'],
              });
              if (!result.canceled && result.filePaths[0]) send('menu-import-skill', result.filePaths[0]);
            },
          },
          {
            label: 'Import Decision Dependency…',
            click: async () => {
              const win = BrowserWindow.getFocusedWindow() || mainWin;
              const result = await dialog.showOpenDialog(win, {
                title: 'Import Decision Dependency',
                filters: [{ name: 'Decision Dependency', extensions: ['yaml', 'yml', 'md'] }],
                properties: ['openFile'],
              });
              if (!result.canceled && result.filePaths[0]) send('menu-import-dd', result.filePaths[0]);
            },
          },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => send('menu-open-settings'),
          },
          {
            label: 'History',
            accelerator: 'CmdOrCtrl+H',
            click: () => send('menu-toggle-history'),
          },
          { type: 'separator' },
          { label: 'Quit', accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4', role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          { label: `Version ${appVersion}`, enabled: false },
          { type: 'separator' },
          { label: 'Contact Us', click: () => send('menu-contact-us') },
          {
            label: 'Report an Issue',
            click: () => shell.openExternal('https://github.com/KeploreAI-Lab/MindAct/issues'),
          },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
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
