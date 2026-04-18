'use strict';
const { contextBridge, clipboard, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 原生目录选择器
  getClipboardFilePaths: () => {
    try { return clipboard.readFilePaths(); } catch { return []; }
  },
  pickFolder: () => ipcRenderer.invoke('show-open-dialog', {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择文件夹',
  }),

  // 自动更新：应用更新并重启
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // 自动更新：监听"下载完成"事件（主进程广播，renderer 监听后显示横幅）
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (_event, info) => callback(info));
  },
});
