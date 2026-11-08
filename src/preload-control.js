const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  chooseFile: () => ipcRenderer.invoke('choose-file'),
  setVideo: p => ipcRenderer.invoke('set-video', p),
  getState: () => ipcRenderer.invoke('get-state'),
  play: () => ipcRenderer.invoke('play'),
  pause: () => ipcRenderer.invoke('pause'),
  stop: () => ipcRenderer.invoke('stop'),
  setVolume: v => ipcRenderer.invoke('set-volume', v),
  setMuted: m => ipcRenderer.invoke('set-muted', m),
  setLoop: l => ipcRenderer.invoke('set-loop', l),
  setFit: f => ipcRenderer.invoke('set-fit', f),
  setSharpness: s => ipcRenderer.invoke('set-sharpness', s),
  setScale: s => ipcRenderer.invoke('set-scale', s),
  setResolution: r => ipcRenderer.invoke('set-resolution', r),
  setAutostart: v => ipcRenderer.invoke('set-autostart', v),
  onState: cb => ipcRenderer.on('state', (e, s) => cb(s))
});