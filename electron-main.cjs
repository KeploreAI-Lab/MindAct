'use strict';
const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// ── 打包环境检测 ──────────────────────────────────────────────────────────────
// 打包后 app.isPackaged = true；开发模式下为 false
const IS_PACKAGED = app.isPackaged;

// Linux: Chromium aborts if chrome-sandbox is not root-owned + setuid (common in node_modules).
// restart.sh exports MINDACT_ELECTRON_NO_SANDBOX=1 when needed; you can set it manually too.
if (process.platform === 'linux' && (process.env.MINDACT_ELECTRON_NO_SANDBOX === '1' || IS_PACKAGED)) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

// ── Server 子进程管理 ─────────────────────────────────────────────────────────
let serverProcess = null;

function startServer() {
  if (!IS_PACKAGED) {
    // 开发模式：用户手动运行 bun run server.ts，这里不再重复启动
    console.log('[electron] Dev mode — using external bun server on :3001');
    return;
  }

  const serverBin = path.join(process.resourcesPath, 'mindact-server');
  const env = {
    ...process.env,
    // Electron 内置 Node.js 路径，server 用它来启动 pty-worker.cjs
    NODE_BINARY: process.execPath,
    // Resources 目录，server 可用于路径解析（补充 import.meta.dir）
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
      if (res.ok || res.status === 500) return; // 服务器已响应（config 可能未设置，返回 500 也算就绪）
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('MindAct server failed to start in time');
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

  // Remove CSP that would block WebSocket connections
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

  win.loadURL('http://localhost:3001');
  win.on('closed', () => { app.quit(); });
}

// ── 自动更新 ──────────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!IS_PACKAGED) {
    console.log('[updater] Dev mode — auto-update disabled');
    return;
  }

  // electron-updater 仅在打包后可用（避免开发时报错）
  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('[updater] electron-updater not available:', e.message);
    return;
  }

  autoUpdater.autoDownload = true;       // 静默后台下载
  autoUpdater.autoInstallOnAppQuit = false; // 我们手动触发安装（用户点击横幅）

  autoUpdater.on('checking-for-update', () => console.log('[updater] Checking for updates...'));
  autoUpdater.on('update-available', (info) => console.log(`[updater] Update available: v${info.version}`));
  autoUpdater.on('update-not-available', () => console.log('[updater] Up to date.'));
  autoUpdater.on('error', (err) => console.error('[updater] Error:', err.message));
  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] Downloading: ${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: v${info.version}`);
    // 通知所有 renderer 窗口显示"重启以应用"横幅
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('update-downloaded', { version: info.version });
    });
  });

  // app 启动 10s 后开始检查，之后每 4 小时检查一次
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => console.error('[updater] Check failed:', e.message));
  }, 10_000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(e => console.error('[updater] Check failed:', e.message));
  }, 4 * 60 * 60 * 1000);
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
app.on('ready', async () => {
  // IPC：原生目录选择器
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, options);
    return result;
  });

  // IPC：安装更新并重启（由 renderer 的"重启以应用"按钮触发）
  ipcMain.handle('install-update', () => {
    let autoUpdater;
    try { autoUpdater = require('electron-updater').autoUpdater; } catch { return; }
    // isSilent=false 让 Windows 安装器显示 UI，forcedDevUpdateConfig=true 重启后打开新版本
    autoUpdater.quitAndInstall(false, true);
  });

  // 启动 server 子进程（打包模式）
  startServer();

  try {
    await waitForServer();
  } catch (err) {
    dialog.showErrorBox('启动失败', '无法连接 MindAct 服务器，请重新打开应用。');
    app.quit();
    return;
  }

  createWindow();
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
