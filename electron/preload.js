// Secure bridge between the renderer (web UI) and the Electron main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rdesk', {
  isElectron: true,
  platform: process.platform,

  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  saveConfig: (partial) => ipcRenderer.invoke('save-config', partial),
  checkPermissions: () => ipcRenderer.invoke('check-permissions'),
  requestPermissions: (type) => ipcRenderer.invoke('request-permissions', type),
  relaunchElevated: () => ipcRenderer.invoke('relaunch-elevated'),

  // Silent screen capture (host side)
  getScreenSource: () => ipcRenderer.invoke('get-screen-source'),

  // Multi-monitor: list screens and pick which one is shared/controlled
  getScreens: () => ipcRenderer.invoke('get-screens'),
  selectScreen: (index) => ipcRenderer.invoke('select-screen', index),

  // Native OS input injection (host side)
  injectInput: (line) => ipcRenderer.send('inject-input', line),
  setRemoteSessionActive: (active) => ipcRenderer.invoke('remote-session-active', !!active),
  readClipboardText: () => ipcRenderer.invoke('clipboard-read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  onUpdateInstalling: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('update-installing', handler);
    return () => ipcRenderer.removeListener('update-installing', handler);
  },

  // Cloudflare tunnel (share embedded server over the internet)
  startTunnel: () => ipcRenderer.invoke('start-tunnel'),
  stopTunnel: () => ipcRenderer.invoke('stop-tunnel'),

  // File transfer to disk (receiver side)
  fileBegin: (id, name) => ipcRenderer.invoke('file-begin', { id, name }),
  fileChunk: (id, chunk) => ipcRenderer.send('file-chunk', { id, chunk }),
  fileEnd: (id) => ipcRenderer.invoke('file-end', { id }),
  openDownloads: () => ipcRenderer.invoke('open-downloads'),
  showInFolder: (p) => ipcRenderer.invoke('open-path', p),

  // Sending files chosen via native dialog (sender side)
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  readFileChunk: (path, offset, length) => ipcRenderer.invoke('read-file-chunk', { path, offset, length }),

  // Window controls
  minimize: () => ipcRenderer.send('window-min'),
  hide: () => ipcRenderer.send('window-hide'),
  quit: () => ipcRenderer.send('app-quit')
});
