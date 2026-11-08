process.noAsar = true;
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(ROOT, 'runtime', 'electron');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage');
const APPDIR = path.join(STAGE, '壁纸');
const ZIP = path.join(DIST, '壁纸-portable-win-x64.zip');

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, base, out);
    else out.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/') });
  }
  return out;
}
function dirSize(p) { let s = 0; for (const f of walk(p)) s += fs.statSync(f.abs).size; return s; }
function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }

function packAsar(files, outPath) {
  const header = { files: {} };
  let offset = 0;
  const contents = [];
  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const parts = f.rel.split('/');
    let node = header;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) node.files[p] = { size: data.length, offset: String(offset) };
      else { if (!node.files[p]) node.files[p] = { files: {} }; node = node.files[p]; }
    }
    contents.push(data);
    offset += data.length;
  }
  const jsonBuf = Buffer.from(JSON.stringify(header), 'utf8');
  const strlen = jsonBuf.length;
  const pad = (4 - (strlen % 4)) % 4;
  const payloadSize = 4 + strlen + pad;
  const headerBuf = Buffer.alloc(4 + payloadSize);
  headerBuf.writeUInt32LE(payloadSize, 0);
  headerBuf.writeUInt32LE(strlen, 4);
  jsonBuf.copy(headerBuf, 8);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(headerBuf.length, 4);
  fs.writeFileSync(outPath, Buffer.concat([sizeBuf, headerBuf, ...contents]));
}

console.log('1) 清理并复制运行时…');
rm(STAGE); fs.mkdirSync(APPDIR, { recursive: true });
fs.cpSync(RUNTIME, APPDIR, { recursive: true });

console.log('2) 重命名主程序…');
fs.renameSync(path.join(APPDIR, 'electron.exe'), path.join(APPDIR, '壁纸.exe'));

console.log('3) 裁剪 locales / 默认应用 / WebGPU 编译器…');
const locDir = path.join(APPDIR, 'locales');
let removed = 0;
for (const f of fs.readdirSync(locDir)) {
  if (!/^(en-US|zh-CN)\.pak$/.test(f)) { rm(path.join(locDir, f)); removed++; }
}
rm(path.join(APPDIR, 'resources', 'default_app.asar'));
const dxc = path.join(APPDIR, 'dxcompiler.dll');
const dxcSize = fs.existsSync(dxc) ? fs.statSync(dxc).size : 0;
rm(dxc);
console.log('   删除 locales ' + removed + ' 个，dxcompiler.dll ' + mb(dxcSize));

console.log('4) 打包应用为 app.asar…');
const appFiles = [{ abs: path.join(ROOT, 'package.json'), rel: 'package.json' }]
  .concat(walk(path.join(ROOT, 'src')).map(f => ({ abs: f.abs, rel: 'src/' + f.rel })))
  .concat(walk(path.join(ROOT, 'assets')).map(f => ({ abs: f.abs, rel: 'assets/' + f.rel })));
packAsar(appFiles, path.join(APPDIR, 'resources', 'app.asar'));
console.log('   纳入 ' + appFiles.length + ' 个文件');

fs.writeFileSync(path.join(APPDIR, '使用说明.txt'),
  '壁纸 · 便携版\r\n\r\n双击「壁纸.exe」启动。\r\n在控制面板选择或拖入视频（MP4/WebM/M4V/OGV）或图片（JPG/PNG/WebP/BMP/GIF），即在桌面图标后方播放。\r\n关闭窗口最小化到托盘，右键托盘图标退出。\r\n设置保存在 %APPDATA%/video-wallpaper，本目录不含任何个人数据。\r\n');

const stageSize = dirSize(STAGE);
console.log('5) 压缩为 zip…');
rm(ZIP);
const tar = 'C:\\Windows\\System32\\tar.exe';
let r;
if (fs.existsSync(tar)) {
  r = spawnSync(tar, ['-a', '-cf', ZIP, '-C', STAGE, '壁纸'], { encoding: 'utf8' });
} else {
  r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${APPDIR}' -DestinationPath '${ZIP}' -Force`], { encoding: 'utf8' });
}
if (r.status !== 0) { console.error('压缩失败', r.stderr || r.stdout); process.exit(1); }

console.log('\n=== 完成 ===');
console.log('便携目录: ' + APPDIR + '  (' + mb(stageSize) + ')');
console.log('分发包:   ' + ZIP + '  (' + mb(fs.statSync(ZIP).size) + ')');