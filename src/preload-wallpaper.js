const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperHost', {
  onLoadMedia: cb => ipcRenderer.on('load-media', (e, data) => cb(data)),
  onCommand: cb => ipcRenderer.on('command', (e, cmd) => cb(cmd)),
  onOptions: cb => ipcRenderer.on('options', (e, opts) => cb(opts)),
  report: state => ipcRenderer.send('play-state', state)
});