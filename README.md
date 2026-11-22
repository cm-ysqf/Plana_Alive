# PLANA ALIVE · Windows 客户端

普拉娜桌面客户端源码，当前版本 **0.3.5**。使用 Electron 和 Spine 3.8 角色渲染，支持透明桌面角色、拖动与锁定、点击穿透、鼠标跟随、摸头互动、精简输入框、角色字幕气泡，以及通过云端服务进行文字聊天与语音播放。

## 环境与资源

- Windows 10/11 x64；Node.js 22.13 或更新版本和 npm。
- 使用你自己合法获取的原壁纸资源。模型、原始语音、第三方 Spine 运行库不包含在此仓库中，也不应随意重新分发。
- 设置 `PLANA_WALLPAPER_DIR` 指向包含 `assets/` 和 `lib/` 的原壁纸根目录。准备脚本会将所需文件复制到被 Git 忽略的本地目录。

需要的资源：`lib/spine-webgl.js`；`assets/NP0035_spr.{skel,atlas,png}`、`assets/arona_spr.{skel,atlas,png}`；`assets/audio/NP0035/np0035_work_talk_1.ogg` 至 `np0035_work_talk_5.ogg`。

## 开发与打包

在项目根目录使用 PowerShell：

```powershell
$env:PLANA_WALLPAPER_DIR = 'D:\your-wallpaper-directory'
npm run setup
npm run prepare-ui
npm start
```

构建可直接运行的单文件 EXE：

```powershell
npm run build
```

产物：`desktop/release/0.3.5/portable/PlanaAlive-0.3.5-Portable.exe`。单文件版启动时会将运行组件解压到临时目录；用户设置独立保存在 Windows 用户应用数据目录。此仓库只提交源码，不提交运行库、依赖或构建产物。

## 云端服务

客户端入口在 `desktop/main.cjs`，其中 `CLOUD` 为服务地址。修改该地址后重新构建即可连接自己的兼容服务。这个仓库只包含客户端，运行聊天和语音需要可用的云端接口；服务端、数据库、管理面板和部署凭据不在此仓库内。

客户端使用 `/api/catalog`、`/api/state`、`/api/events`、`/api/control`、`/api/action`、`/api/inference/config`、`/api/chat`、`/api/tts` 以及 `/api/diagnostics/hardware`。聊天 API 密钥由服务器保存，不打包进客户端。

配置统计仅包含客户端版本、操作系统与架构、CPU 型号与核心数、内存容量和 GPU 名称；字段白名单见 `desktop/hardware.cjs`。不采集电脑名称、地区、用户名或硬件序列号。

## 目录

- `desktop/`：Electron 入口、IPC、窗口交互、消息与设置界面、构建脚本。
- `public/`：客户端复用的角色渲染、动画、音频及对话逻辑；其中部分页面控件由云端工作室复用。
- `model-data.mjs`：模型元数据读取，供渲染测试使用。
- `test/`、`desktop/test/`：对话、口型、音频、窗口与设置等测试。

## 验证

先准备资源，再运行：

```powershell
npm test
```

`desktop/scripts/smoke-startup.cjs` 使用隐藏的 Electron 窗口验证启动错误提示和恢复，不连接生产云端：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& ./desktop/node_modules/electron/dist/electron.exe ./desktop/scripts/smoke-startup.cjs --disable-gpu
```

`desktop/scripts/smoke.cjs` 是需要兼容云端服务的集成测试，会产生测试请求并以静音窗口运行。首次构建 Electron 时需要网络下载构建依赖。

## 授权

仓库暂未授予开源许可证（`UNLICENSED`）。角色素材及第三方运行库的权利归各自权利人；公开源码不代表取得这些素材的再分发授权。
