const { app, BrowserWindow, ipcMain, dialog, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');

const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const VID_EXT = ['mp4', 'webm', 'm4v', 'ogv', 'ogg'];
function mediaType(p) {
  const e = path.extname(p).slice(1).toLowerCase();
  if (IMG_EXT.includes(e)) return 'image';
  if (VID_EXT.includes(e)) return 'video';
  return 'video';
}

let settings = {
  lastVideo: null, volume: 0.5, muted: true, loop: true, autostart: false,
  fit: 'cover', resolution: 'auto', sharpness: 1, scale: 100, stopped: false,
  history: [], carousel: false, dwell: 10
};
let playState = { status: 'stopped', file: null, currentTime: 0, duration: 0, error: null };
let attachMode = 'unknown';
let controlWin = null, wallpaperWin = null, tray = null, quitting = false;
let dwellTimer = null;

function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))); } catch {}
  if (!Array.isArray(settings.history)) settings.history = [];
  settings.history = settings.history.filter(h => h && typeof h.path === 'string');
}
function saveSettings() { try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch {} }

function virtualScreenBounds() {
  const ds = screen.getAllDisplays();
  const x = Math.min(...ds.map(d => d.bounds.x)), y = Math.min(...ds.map(d => d.bounds.y));
  const r = Math.max(...ds.map(d => d.bounds.x + d.bounds.width)), b = Math.max(...ds.map(d => d.bounds.y + d.bounds.height));
  return { x, y, width: r - x, height: b - y };
}
function physicalBounds() {
  const ds = screen.getAllDisplays();
  let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
  for (const d of ds) {
    const s = d.scaleFactor;
    x = Math.min(x, d.bounds.x * s); y = Math.min(y, d.bounds.y * s);
    r = Math.max(r, (d.bounds.x + d.bounds.width) * s); b = Math.max(b, (d.bounds.y + d.bounds.height) * s);
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(r - x), height: Math.round(b - y) };
}
function resolutionPercent() { return settings.resolution === 'auto' ? 100 : Number(settings.resolution) || 100; }

function attachScriptPath() {
  const src = path.join(__dirname, 'attach-desktop.ps1');
  // PowerShell 是外部进程，读不了 asar 内的文件；打包运行时先解出到临时目录
  if (!src.includes('.asar')) return src;
  const tmp = path.join(os.tmpdir(), 'video-wallpaper-attach.ps1');
  fs.writeFileSync(tmp, fs.readFileSync(src));
  return tmp;
}
function attachToDesktop(done) {
  if (!wallpaperWin || wallpaperWin.isDestroyed()) return done && done();
  const hwnd = wallpaperWin.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', attachScriptPath(), hwnd], { windowsHide: true });
  let out = '';
  ps.stdout.on('data', d => { out += d; });
  ps.on('close', () => {
    const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    attachMode = lines[lines.length - 1] || 'error';
    pushState(); done && done();
  });
}
function calibrate() {
  if (!wallpaperWin || wallpaperWin.isDestroyed()) return;
  const pct = resolutionPercent() / 100;
  const phys = physicalBounds();
  const wc = wallpaperWin.webContents;
  if (pct === 1) { wc.disableDeviceEmulation(); return; }
  wc.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: phys.width, height: phys.height },
    deviceScaleFactor: pct,
    viewPosition: { x: 0, y: 0 },
    viewSize: { width: phys.width, height: phys.height },
    scale: 1
  });
}

// ---- 媒体历史 ----
function addToHistory(p, type) {
  const i = settings.history.findIndex(h => h.path === p);
  if (i >= 0) settings.history[i].type = type;
  else settings.history.push({ path: p, type, addedAt: Date.now() });
}
function historyView() {
  return settings.history.map(h => ({
    path: h.path, type: h.type, addedAt: h.addedAt,
    valid: fs.existsSync(h.path), current: h.path === settings.lastVideo
  }));
}
function currentType() {
  const h = settings.history.find(x => x.path === settings.lastVideo);
  return h ? h.type : mediaType(settings.lastVideo);
}
function effectiveLoop() { return settings.carousel ? false : settings.loop; }

// ---- 轮播 ----
function clearDwell() { if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; } }
function armDwell() {
  clearDwell();
  if (settings.carousel && !settings.stopped && currentType() === 'image' &&
      settings.lastVideo && fs.existsSync(settings.lastVideo)) {
    dwellTimer = setTimeout(() => { dwellTimer = null; advance(1); }, Math.max(1, Number(settings.dwell) || 10) * 1000);
  }
}
function indexOfCurrent() { return settings.history.findIndex(h => h.path === settings.lastVideo); }
function nextValidIndex(from, dir) {
  const n = settings.history.length; if (!n) return -1;
  for (let step = 1; step <= n; step++) {
    const i = ((from + dir * step) % n + n) % n;
    if (fs.existsSync(settings.history[i].path)) return i;
  }
  return -1;
}
function advance(dir) {
  if (!settings.history.length) return false;
  let from = indexOfCurrent();
  if (from < 0) from = dir > 0 ? -1 : 0;
  const i = nextValidIndex(from, dir);
  if (i < 0) return false;
  playMedia(settings.history[i].path);
  return true;
}

function sendCurrentMedia() {
  if (!wallpaperWin || wallpaperWin.isDestroyed()) return;
  if (settings.lastVideo && fs.existsSync(settings.lastVideo)) {
    playState.file = settings.lastVideo; playState.error = null;
    wallpaperWin.webContents.send('load-media', {
      url: pathToFileURL(settings.lastVideo).href, type: currentType(),
      volume: settings.volume, muted: settings.muted, loop: effectiveLoop(),
      fit: settings.fit, sharpness: settings.sharpness, scale: settings.scale
    });
  } else if (settings.lastVideo) {
    playState.file = settings.lastVideo; playState.error = '文件不存在或已被移动';
  }
}
function playMedia(p) {
  addToHistory(p, mediaType(p));
  settings.lastVideo = p; settings.stopped = false; saveSettings();
  clearDwell();
  sendCurrentMedia();
  if (fs.existsSync(p)) {
    wallpaperWin.showInactive();
    wallpaperWin.webContents.send('command', 'play');
  }
  calibrate();
  armDwell();
  pushState();
}
function pushState() {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send('state', { settings, playState, attachMode, native: physicalBounds(), history: historyView() });
  }
}

function createWallpaperWindow() {
  wallpaperWin = new BrowserWindow({
    ...virtualScreenBounds(), show: false, frame: false, thickFrame: false,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, focusable: false, backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-wallpaper.js'), contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
    }
  });
  wallpaperWin.setMenu(null);
  wallpaperWin.loadFile(path.join(__dirname, 'wallpaper.html'));
  wallpaperWin.webContents.on('did-finish-load', () => {
    attachToDesktop(() => {
      sendCurrentMedia();
      calibrate();
      if (!settings.stopped && settings.lastVideo) {
        wallpaperWin.showInactive();
        wallpaperWin.webContents.send('command', 'play');
        armDwell();
      }
    });
  });
  wallpaperWin.on('close', e => { if (!quitting) { e.preventDefault(); wallpaperWin.hide(); } });
}
function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 520, height: 900, resizable: false, title: '视频壁纸', icon: ICON_PATH,
    backgroundColor: '#0b0e14', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-control.js'), contextIsolation: true, nodeIntegration: false }
  });
  controlWin.setMenu(null);
  controlWin.loadFile(path.join(__dirname, 'control.html'));
  controlWin.on('close', e => { if (!quitting) { e.preventDefault(); controlWin.hide(); } });
  controlWin.webContents.on('did-finish-load', pushState);
}
function showControl() {
  if (!controlWin || controlWin.isDestroyed()) createControlWindow();
  controlWin.show(); controlWin.focus(); pushState();
}

function doPlay() {
  if (!settings.lastVideo) return false;
  settings.stopped = false; saveSettings();
  if (fs.existsSync(settings.lastVideo)) {
    wallpaperWin.showInactive();
    wallpaperWin.webContents.send('command', 'play');
    armDwell();
  } else {
    playState.error = '文件不存在或已被移动'; pushState();
  }
  return true;
}
function doPause() { clearDwell(); wallpaperWin.webContents.send('command', 'pause'); }
function doStop() {
  clearDwell();
  wallpaperWin.webContents.send('command', 'pause');
  wallpaperWin.hide();
  settings.stopped = true; saveSettings();
  playState.status = 'stopped'; pushState();
}
function trayToggle() { playState.status === 'playing' ? doPause() : doPlay(); }

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 }));
  tray.setToolTip('视频壁纸');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开控制面板', click: showControl },
    { label: '播放 / 暂停', click: trayToggle },
    { label: '停止（恢复桌面）', click: doStop },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showControl);
}
function applyAutostart() {
  app.setLoginItemSettings({ openAtLogin: !!settings.autostart, args: [path.resolve(app.getAppPath())] });
}

ipcMain.handle('choose-file', async () => {
  const r = await dialog.showOpenDialog(controlWin, {
    title: '选择视频或图片', properties: ['openFile'],
    filters: [
      { name: '媒体文件', extensions: [...VID_EXT, ...IMG_EXT] },
      { name: '视频文件', extensions: VID_EXT },
      { name: '图片文件', extensions: IMG_EXT },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (!r.canceled && r.filePaths[0]) playMedia(r.filePaths[0]);
  return settings.lastVideo;
});
ipcMain.handle('set-video', (e, p) => { if (typeof p === 'string' && p) playMedia(p); });
ipcMain.handle('get-state', () => ({ settings, playState, attachMode, native: physicalBounds(), history: historyView() }));
ipcMain.handle('play', () => doPlay());
ipcMain.handle('pause', () => doPause());
ipcMain.handle('stop', () => doStop());
ipcMain.handle('next', () => advance(1));
ipcMain.handle('prev', () => advance(-1));
ipcMain.handle('select-history', (e, p) => {
  if (!settings.history.some(h => h.path === p) || !fs.existsSync(p)) { pushState(); return false; }
  playMedia(p); return true;
});
ipcMain.handle('delete-history', (e, p) => {
  const i = settings.history.findIndex(h => h.path === p);
  if (i < 0) return null;
  const ni = nextValidIndex(i, 1);
  const [removed] = settings.history.splice(i, 1);
  saveSettings();
  if (settings.lastVideo === p) {
    clearDwell();
    const target = ni >= 0 ? settings.history[ni - 1] : null;
    if (target) playMedia(target.path);
    else { settings.lastVideo = null; saveSettings(); doStop(); }
  }
  pushState();
  return removed;
});
ipcMain.handle('restore-history', (e, item) => {
  if (item && typeof item.path === 'string' && !settings.history.some(h => h.path === item.path)) {
    settings.history.push({ path: item.path, type: item.type || mediaType(item.path), addedAt: item.addedAt || Date.now() });
    saveSettings(); pushState();
  }
});
ipcMain.handle('set-volume', (e, v) => { settings.volume = Math.min(1, Math.max(0, Number(v) || 0)); saveSettings(); wallpaperWin.webContents.send('options', { volume: settings.volume }); });
ipcMain.handle('set-muted', (e, m) => { settings.muted = !!m; saveSettings(); wallpaperWin.webContents.send('options', { muted: settings.muted }); });
ipcMain.handle('set-loop', (e, l) => { settings.loop = !!l; saveSettings(); wallpaperWin.webContents.send('options', { loop: effectiveLoop() }); });
ipcMain.handle('set-carousel', (e, v) => {
  settings.carousel = !!v; saveSettings();
  wallpaperWin.webContents.send('options', { loop: effectiveLoop() });
  if (settings.carousel) armDwell(); else clearDwell();
  pushState();
});
ipcMain.handle('set-dwell', (e, v) => { settings.dwell = Math.min(120, Math.max(1, Number(v) || 10)); saveSettings(); armDwell(); pushState(); });
ipcMain.handle('set-fit', (e, f) => { if (['cover', 'contain', 'fill', 'center', 'tile'].includes(f)) { settings.fit = f; saveSettings(); wallpaperWin.webContents.send('options', { fit: f }); } });
ipcMain.handle('set-sharpness', (e, s) => { settings.sharpness = Math.min(3, Math.max(0, Number(s) || 0)); saveSettings(); wallpaperWin.webContents.send('options', { sharpness: settings.sharpness }); });
ipcMain.handle('set-scale', (e, s) => { settings.scale = Math.min(200, Math.max(50, Number(s) || 100)); saveSettings(); wallpaperWin.webContents.send('options', { scale: settings.scale }); });
ipcMain.handle('set-resolution', (e, r) => { settings.resolution = r === 'auto' ? 'auto' : Math.min(200, Math.max(25, Number(r) || 100)); saveSettings(); calibrate(); });
ipcMain.handle('set-autostart', (e, v) => { settings.autostart = !!v; saveSettings(); applyAutostart(); });

ipcMain.on('play-state', (e, s) => {
  playState.currentTime = s.currentTime || 0;
  playState.duration = s.duration || 0;
  if (s.error !== undefined) playState.error = s.error;
  playState.status = settings.stopped ? 'stopped' : (s.playing ? 'playing' : 'paused');
  if (s.ended === true && settings.carousel && !settings.stopped) { advance(1); return; }
  pushState();
});

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', showControl);
  app.whenReady().then(() => {
    loadSettings();
    createWallpaperWindow();
    createControlWindow();
    createTray();
    applyAutostart();
    screen.on('display-metrics-changed', () => {
      if (wallpaperWin && !wallpaperWin.isDestroyed()) {
        wallpaperWin.setBounds(virtualScreenBounds());
        attachToDesktop(() => calibrate());
      }
    });
  });
}
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {});