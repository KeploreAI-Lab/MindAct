'use strict';
const { contextBridge, clipboard, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getClipboardFilePaths: () => {
    try { return clipboard.readFilePaths(); } catch { return []; }
  },
  pickFolder: () => ipcRenderer.invoke('show-open-dialog', {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择文件夹',
  }),
});
