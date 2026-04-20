'use strict';
const { contextBridge, clipboard, nativeImage, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 原生目录选择器
  getClipboardFilePaths: () => {
    try { return clipboard.readFilePaths(); } catch { return []; }
  },

  // Windows 截图粘贴支持：读取剪贴板原生图片 → base64 PNG
  getClipboardImage: () => {
    try {
      const img = clipboard.readImage();
      if (!img || img.isEmpty()) return null;
      return img.toPNG().toString('base64');
    } catch { return null; }
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

  // 原生菜单事件：转发给 renderer（Settings、History、Contact Us 等）
  onMenuEvent: (callback) => {
    ipcRenderer.on('menu-event', (_event, eventName, data) => callback(eventName, data));
  },
});
