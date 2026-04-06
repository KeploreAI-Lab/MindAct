'use strict';
const { contextBridge, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Returns array of absolute file paths currently in the clipboard (macOS Finder copy)
  getClipboardFilePaths: () => {
    try { return clipboard.readFilePaths(); } catch { return []; }
  },
});
