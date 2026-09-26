# JingLianTai · 精炼台

JingLianTai（精炼台）是一款轻量的 macOS 菜单栏与 Windows 系统托盘提示词优化工具。输入一句自然语言需求，点击闪光图标即可调用 Trae 的提示词优化能力，结果会直接替换原文；再次点击同一位置即可撤销。

应用不需要安装或运行 TraeCode。首次优化时会在应用内打开 Trae 官方登录页面，登录成功后即可独立使用。

## 主要功能

- **极简托盘界面**：左键系统图标打开输入框，右键打开功能菜单。
- **原位优化与撤销**：优化结果直接替换输入内容，并保留一次内存撤销。
- **自由拖动与位置恢复**：可拖动顶部细栏或窗口外边缘，窗口会吸附屏幕边界并记住最终位置。
- **窗口置顶切换**：通过右上角图钉控制置顶；置顶时切换其他应用仍保持显示。
- **剪贴板优化**：可从右键菜单直接优化剪贴板；成功后仅在剪贴板仍为原内容时覆盖。优化期间复制了新内容时保留新内容，结果仍显示在编辑器中。
- **全局快捷键**：macOS 默认使用 `⌥⌘P`，Windows 默认使用 `Ctrl+Alt+P`。
- **快捷键自动优化**：可在设置中开启；按下全局快捷键后自动读取剪贴板、开始优化并用结果覆盖剪贴板，撤销时恢复原内容。
- **登录时启动**：可在右键菜单中开启或关闭。
- **无模型回退**：只调用 Trae `input_optimization / no_thinking_model`，不会转用 GPT、Codex CLI 或其他模型。
- **本地隐私保护**：不保存提示词和优化历史；登录令牌由系统 `safeStorage` 加密保存。

## 系统要求

- Apple Silicon Mac（M1、M2、M3、M4 或更新芯片）
- Windows 10/11 x64
- 可访问 Trae 中国版服务
- 有效的 Trae CN 账号和可用 Credits

当前版本不支持 Intel Mac 和 Windows ARM64。

## 下载安装

从 [Releases](https://github.com/tianpeng-dev/jingliantai/releases/latest) 下载对应平台的安装包。

### macOS

1. 下载 `JingLianTai-1.3.3-mac-arm64.zip`，解压后将“精炼台.app”移动到 `/Applications`。
2. 当前安装包采用完整临时签名，但未进行 Apple 公证。首次安装后在“终端”执行：`xattr -cr "/Applications/精炼台.app"`。
3. 双击打开精炼台，再点击顶部菜单栏的闪光图标开始使用。

### Windows

1. 下载 `JingLianTai-1.3.3-win-x64.exe` 并运行安装程序。
2. 当前版本未进行 Windows 代码签名，Microsoft Defender SmartScreen 可能提示“Windows 已保护你的电脑”；确认来源后选择“更多信息”再运行。
3. 安装完成后，从开始菜单打开精炼台，应用会驻留在任务栏通知区域。

首次优化时完成一次 Trae 官方网页登录；以后会复用该电脑上加密保存的登录凭证。

登录状态不会打包在应用内，也不会随 `.app` 或 `.exe` 复制到其他电脑。每台新电脑首次使用时都需要登录一次，但不需要安装 TraeCode。

## 使用方式

### 优化输入内容

1. 左键点击系统图标；也可以在 macOS 按下 `⌥⌘P`，或在 Windows 按下 `Ctrl+Alt+P`。
2. 输入需要优化的提示词。
3. 点击右下角闪光图标，或按 `Enter`；需要换行时使用 `Shift+Enter`。
4. 优化完成后，闪光图标会变成撤销图标。

### 右键菜单

右键点击菜单栏或任务栏通知区域中的精炼台图标可以：

- 打开精炼台
- 优化剪贴板
- 撤销上次剪贴板替换
- 设置登录时启动
- 修改全局快捷键
- 退出应用

## 隐私与安全

- Renderer 无权访问文件系统、Trae Token、任意网络地址或执行命令。
- Trae 登录窗口使用隔离的 Electron 会话。
- Token 只在 Electron 主进程内存中使用；macOS 使用钥匙串、Windows 使用 DPAPI 支撑的 `safeStorage` 加密保存。
- 普通提示词和优化结果不会由应用写入磁盘。应用保存设置和加密登录令牌；隔离的持久化登录会话还会保存 Trae 登录 Cookies、网站存储与缓存，以支持会话恢复。这些数据不打包、不上传到项目仓库。
- Token 确认失效后先尝试网页会话恢复；只有确需登录时才打开登录页。网络故障不会被当作登录失效，也不会回退到其他模型。
- 优化与撤销均检查剪贴板是否仍归当前操作所有，不覆盖后来复制的内容；编辑优化结果会退出撤销模式，可继续按 Enter 优化。
- 登录窗口限制为显式允许的 HTTPS 登录域名、默认拒绝权限请求；带凭据的接口不跟随重定向。所有桌面 IPC 验证主窗口及顶层 Frame 来源。

## 本地开发

需要 Node.js 24 和 pnpm 9。构建 macOS 图标还需要 Xcode Command Line Tools。

```bash
pnpm install
pnpm dev
```

## 测试与构建

```bash
pnpm test
pnpm typecheck
pnpm format:check
pnpm smoke:electron
pnpm build
pnpm pack:mac
pnpm pack:win
```

构建产物输出到：

```text
release/mac-arm64/精炼台.app
release/JingLianTai-1.3.3-mac-arm64.zip
release/JingLianTai-1.3.3-win-x64.exe
```

## 技术说明与限制

- Electron 43 + TypeScript。
- 主进程、Preload 和 Renderer 使用同一份类型化接口；构建时将 Preload 打包为独立沙箱兼容脚本。打包命令显式禁用隐式发布，不需要 GitHub Token。
- 提供 macOS 菜单栏和 Windows 系统托盘应用，不包含 Web 服务或 HTTP API。
- 优化请求按 Trae CN 3.3.88 的原生流程构造：使用其默认输入优化模板，并以 `user_input / placeholder_map` 结构提交原文；应用不会创建 `⟦PROTECTED_*⟧` 内部占位符。
- `no_thinking_model` 采用随机生成；即使请求参数一致，同一输入在 TraeCode 和精炼台中也可能得到措辞、长度和结构不同但语义相近的结果，不保证逐字一致。
- Trae 的优化接口属于未公开的内部接口，Trae 修改登录流程、端点或协议后，应用可能需要同步更新。
- 每次优化可能消耗 Trae Credits。
- macOS 构建会对完整应用和最终 ZIP 执行临时签名校验，但未进行 Apple 公证，首次安装需要解除隔离；Windows 构建尚未进行代码签名。两者都不支持自动更新。
- 本项目为独立工具，与 Trae 官方无隶属或授权关系。
