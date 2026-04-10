const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('path');

// Linux: Chromium aborts if chrome-sandbox is not root-owned + setuid (common in node_modules).
// restart.sh exports MINDACT_ELECTRON_NO_SANDBOX=1 when needed; you can set it manually too.
if (process.platform === 'linux' && process.env.MINDACT_ELECTRON_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

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

  // DevTools off in normal use
  // win.webContents.openDevTools();

  win.on('closed', () => { app.quit(); });
}

app.on('ready', () => {
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, options);
    return result;
  });
  createWindow();
});
app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
