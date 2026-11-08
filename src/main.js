const { app, BrowserWindow, ipcMain, dialog, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');

let settings = {
  lastVideo: null, volume: 0.5, muted: true, loop: true, autostart: false,
  fit: 'cover', resolution: 'auto', sharpness: 1, scale: 100, stopped: false
};
let playState = { status: 'stopped', file: null, currentTime: 0, duration: 0, error: null };
let attachMode = 'unknown';
let controlWin = null, wallpaperWin = null, tray = null, quitting = false;

function loadSettings() { try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))); } catch {} }
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

function sendCurrentVideo() {
  if (!wallpaperWin || wallpaperWin.isDestroyed()) return;
  if (settings.lastVideo && fs.existsSync(settings.lastVideo)) {
    playState.file = settings.lastVideo;
    playState.error = null;
    wallpaperWin.webContents.send('load-video', {
      url: pathToFileURL(settings.lastVideo).href,
      volume: settings.volume, muted: settings.muted, loop: settings.loop,
      fit: settings.fit, sharpness: settings.sharpness, scale: settings.scale
    });
  }
}
function setVideo(filePath) {
  settings.lastVideo = filePath; settings.stopped = false; saveSettings();
  sendCurrentVideo();
  wallpaperWin.showInactive();
  wallpaperWin.webContents.send('command', 'play');
  calibrate();
}
function pushState() {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send('state', { settings, playState, attachMode, native: physicalBounds() });
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
      sendCurrentVideo();
      calibrate();
      if (!settings.stopped && settings.lastVideo) {
        wallpaperWin.showInactive();
        wallpaperWin.webContents.send('command', 'play');
      }
    });
  });
  wallpaperWin.on('close', e => { if (!quitting) { e.preventDefault(); wallpaperWin.hide(); } });
}

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 520, height: 860, resizable: false, title: '视频壁纸', icon: ICON_PATH,
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
  wallpaperWin.showInactive();
  wallpaperWin.webContents.send('command', 'play');
  return true;
}
function doPause() { wallpaperWin.webContents.send('command', 'pause'); }
function doStop() {
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
    title: '选择视频文件', properties: ['openFile'],
    filters: [{ name: '视频文件', extensions: ['mp4', 'webm', 'm4v', 'ogv', 'ogg'] }, { name: '所有文件', extensions: ['*'] }]
  });
  if (!r.canceled && r.filePaths[0]) setVideo(r.filePaths[0]);
  return settings.lastVideo;
});
ipcMain.handle('set-video', (e, p) => { if (typeof p === 'string' && p) setVideo(p); });
ipcMain.handle('get-state', () => ({ settings, playState, attachMode, native: physicalBounds() }));
ipcMain.handle('play', () => doPlay());
ipcMain.handle('pause', () => doPause());
ipcMain.handle('stop', () => doStop());
ipcMain.handle('set-volume', (e, v) => { settings.volume = Math.min(1, Math.max(0, Number(v) || 0)); saveSettings(); wallpaperWin.webContents.send('options', { volume: settings.volume }); });
ipcMain.handle('set-muted', (e, m) => { settings.muted = !!m; saveSettings(); wallpaperWin.webContents.send('options', { muted: settings.muted }); });
ipcMain.handle('set-loop', (e, l) => { settings.loop = !!l; saveSettings(); wallpaperWin.webContents.send('options', { loop: settings.loop }); });
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