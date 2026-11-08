# 视频壁纸 · Desktop Video Wallpaper

在 Windows 桌面图标**后方**循环播放视频文件的壁纸软件。基于 Electron，通过 WorkerW 嵌入把视频窗口挂到桌面壁纸层，图标与任务栏不受影响。

![控制面板](docs/screenshot.png)

## 功能特性

- **原生分辨率清晰渲染**：默认按屏幕物理像素 1:1 渲染（如 2560×1600），不经过 CSS 放大，画面锐利。
- **五种填充效果**：填充（cover）、适应（contain）、拉伸（fill）、居中（center）、平铺（tile）。
- **渲染分辨率可调**：自动（屏幕原生）或 25%–200% 手动缩放，低配机器可降档省资源。
- **清晰度·锐化**：关闭 / 轻度 / 标准 / 强烈 四档 SVG 卷积锐化。
- **画面大小**：50%–200% 壁纸层缩放。
- **开始 / 停止可反复切换**：停止后隐藏壁纸层，**桌面恢复原壁纸**，不留黑屏；再次开始即恢复播放。
- **设置持久化**：所有选项与上次视频保存在 `%APPDATA%/video-wallpaper`，重启自动恢复。
- **托盘与开机自启**：关闭窗口最小化到托盘，右键托盘退出；可选开机自启。
- **声音控制**：音量滑杆、静音、循环开关。
- **便携分发**：单目录解压即用，无需安装。

## 画面设置说明

| 选项 | 取值 | 说明 |
| --- | --- | --- |
| 填充效果 | 填充 / 适应 / 拉伸 / 居中 / 平铺 | 视频与屏幕的适配方式；平铺用 canvas 重复绘制 |
| 渲染分辨率 | 自动 / 25%–200% | 自动 = 屏幕原生分辨率；手动档通过设备 emulation 改变光栅像素密度 |
| 清晰度·锐化 | 关闭 / 轻度 / 标准 / 强烈 | `feConvolveMatrix` 锐化滤镜，补偿视频压缩损失 |
| 画面大小 | 50%–200% | 壁纸层整体缩放（CSS transform） |

## 使用方法

### 便携版（推荐）

1. 下载 `视频壁纸-portable-win-x64.zip` 并解压到任意目录。
2. 双击 `视频壁纸.exe`。
3. 在控制面板点文件夹图标选择视频，或直接把视频文件拖入窗口（支持 MP4 / WebM / M4V / OGV）。
4. 视频即在桌面图标后方播放。关闭窗口最小化到托盘，右键托盘图标退出。

### 从源码运行（开发）

需要 Electron 运行时（见下方「构建」第 1 步），然后：

```bat
启动壁纸.bat
```

或 `runtime\electron\electron.exe .`

## 构建便携包

1. 准备 Electron 运行时：下载 [Electron](https://github.com/electron/electron/releases) **v45.2.3** 的 `electron-v45.2.3-win32-x64.zip`，解压到 `runtime/electron/`（使 `runtime/electron/electron.exe` 存在）。
2. 运行打包脚本（用任意 Node.js ≥ 18）：

   ```bash
   node tools/build-portable.js
   ```

3. 产物：
   - `dist/stage/视频壁纸/` —— 便携目录（约 285 MB）
   - `dist/视频壁纸-portable-win-x64.zip` —— 分发包（约 129 MB）

脚本会重命名主程序、裁剪 locales（仅留 en-US / zh-CN）、删除 `default_app.asar` 与 `dxcompiler.dll`，并把 `package.json + src/ + assets/` 打包为 `app.asar`。

## 目录结构

```
├── src/
│   ├── main.js              # 主进程：窗口、WorkerW 嵌入、状态机、IPC、设置持久化
│   ├── control.html         # 控制面板 UI
│   ├── wallpaper.html       # 壁纸渲染层（video + canvas 平铺 + 锐化滤镜）
│   ├── preload-control.js   # 控制面板桥接
│   ├── preload-wallpaper.js # 壁纸层桥接
│   └── attach-desktop.ps1   # WorkerW / Progman 嵌入（C# SetParent）
├── assets/icon.png
├── tools/build-portable.js  # 便携包打包脚本
├── docs/screenshot.png
├── package.json
├── 启动壁纸.bat
└── README.md
```

## 技术说明

- **桌面嵌入**：Win10 把壁纸窗口 `SetParent` 到 WorkerW；Win11（build 26200+）的 WorkerW 是 Progman 的**子窗口**，脚本用 `EnumChildWindows` 定位可见 WorkerW 再嵌入（`workerw-child` 模式），回退 Progman。
- **清晰度根因与修复**：无边框窗口默认带不可见框架 inset，会把客户区缩小再拉伸导致模糊；设 `thickFrame: false` 后光栅等于物理分辨率。分辨率缩放不用 `zoomFactor`（它只改 `devicePixelRatio`、光栅不变），改用 `webContents.enableDeviceEmulation({ deviceScaleFactor })`。
- **停止恢复桌面**：停止时 `hide()` 壁纸窗口而非销毁，桌面原壁纸自然露出；状态机以 `settings.stopped` + 播放回报判定，开始/停止可无限循环。

## 隐私说明

- 仓库与分发包**不含**任何本地设置、缓存、运行日志、个人视频或桌面截图。
- 用户设置仅保存在本机 `%APPDATA%/video-wallpaper/settings.json`。
- `.gitignore` 已排除 `runtime/`、`dist/`、`qa/`、日志与所有视频文件。

## 系统要求

Windows 10 / 11 x64。

## 许可证

[MIT](LICENSE)