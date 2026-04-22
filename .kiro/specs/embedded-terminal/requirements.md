# 需求文档

## 简介

StowMind 是一款基于 Tauri 1.5 + React 18 的桌面文件整理应用，已集成 Mole（开源系统深度清理 CLI 工具）。当前的深度清理页面尝试通过 GUI 包装 Mole 的交互式 TUI 命令（`mo clean`、`mo purge` 等），但由于这些命令需要终端交互（方向键选择、确认提示、vim 键绑定），GUI 方式无法正常工作。

本功能将当前的 GUI 方式替换为内嵌终端面板方案：在深度清理页面展示 Mole 命令卡片，点击任意命令后在应用内打开一个基于 xterm.js 的嵌入式终端，以完整的 PTY 支持运行 Mole 的交互式命令。

## 术语表

- **StowMind**: 基于 Tauri 1.5 + React 18 + TypeScript 的桌面文件整理应用
- **Mole**: 开源 macOS/Windows 深度清理 CLI 工具（https://github.com/tw93/Mole），提供交互式 TUI 界面
- **DeepClean_Page**: StowMind 中的深度清理页面（`src/pages/DeepCleanPage.tsx`），展示 Mole 命令卡片并承载嵌入式终端
- **Terminal_Panel**: 基于 xterm.js 的嵌入式终端组件，在 DeepClean_Page 内渲染，用于运行 Mole 交互式命令
- **PTY_Backend**: Rust 后端的伪终端（pseudo-terminal）模块，负责创建 PTY 会话、启动子进程、在前端与子进程之间双向转发数据
- **Command_Card**: DeepClean_Page 上展示单个 Mole 命令的 UI 卡片，包含命令名称、描述和启动按钮
- **xterm.js**: 基于 Web 的终端模拟器库，支持 ANSI 转义序列、颜色渲染和键盘输入
- **PTY**: 伪终端（Pseudo-Terminal），操作系统提供的虚拟终端接口，允许程序模拟终端交互

## 需求

### 需求 1：PTY 后端会话管理

**用户故事：** 作为 StowMind 用户，我希望应用后端能创建和管理伪终端会话，以便 Mole 的交互式 TUI 命令能在应用内正常运行。

#### 验收标准

1. WHEN 前端请求创建终端会话时，THE PTY_Backend SHALL 创建一个新的 PTY 会话并返回唯一的会话标识符
2. WHEN PTY 会话创建成功后，THE PTY_Backend SHALL 在该 PTY 中启动用户指定的 Mole 命令作为子进程
3. WHILE PTY 会话处于活跃状态，THE PTY_Backend SHALL 将子进程的 stdout 数据通过 Tauri 事件通道实时转发给前端
4. WHEN 前端发送键盘输入数据时，THE PTY_Backend SHALL 将输入数据写入对应 PTY 会话的 stdin
5. WHEN 子进程退出时，THE PTY_Backend SHALL 通过 Tauri 事件通知前端进程已结束，并包含退出状态码
6. WHEN 前端请求关闭终端会话时，THE PTY_Backend SHALL 终止子进程并释放 PTY 资源
7. IF PTY 创建失败（如平台不支持），THEN THE PTY_Backend SHALL 返回包含失败原因的错误信息

### 需求 2：前端终端模拟器组件

**用户故事：** 作为 StowMind 用户，我希望在应用内看到一个功能完整的终端界面，以便我能与 Mole 的 TUI 进行交互操作。

#### 验收标准

1. THE Terminal_Panel SHALL 使用 xterm.js 渲染终端界面，支持 ANSI 颜色和样式转义序列
2. WHEN Terminal_Panel 接收到来自 PTY_Backend 的 stdout 数据事件时，THE Terminal_Panel SHALL 将数据写入 xterm.js 实例进行渲染
3. WHEN 用户在 Terminal_Panel 中按下键盘按键时，THE Terminal_Panel SHALL 将按键数据发送到 PTY_Backend 的 stdin
4. THE Terminal_Panel SHALL 支持方向键、回车键、退格键和 Ctrl 组合键的输入，以满足 Mole TUI 的交互需求
5. WHEN Terminal_Panel 所在容器尺寸变化时，THE Terminal_Panel SHALL 自动调整终端的行列数并通知 PTY_Backend 更新 PTY 窗口大小
6. WHEN 收到子进程退出事件时，THE Terminal_Panel SHALL 在终端中显示进程已结束的提示信息
7. THE Terminal_Panel SHALL 使用 xterm.js 的 FitAddon 确保终端内容填满可用空间

### 需求 3：深度清理页面重构

**用户故事：** 作为 StowMind 用户，我希望深度清理页面以命令卡片的形式展示所有 Mole 功能，点击后直接在应用内运行，而不是跳转到外部终端。

#### 验收标准

1. THE DeepClean_Page SHALL 展示以下 Mole 命令的 Command_Card：`mo`（交互菜单）、`mo clean`、`mo uninstall`、`mo optimize`、`mo analyze`、`mo status`、`mo purge`、`mo installer`
2. WHEN 用户点击某个 Command_Card 时，THE DeepClean_Page SHALL 在页面内打开 Terminal_Panel 并自动执行对应的 Mole 命令
3. WHILE Terminal_Panel 处于打开状态，THE DeepClean_Page SHALL 提供关闭终端的按钮，允许用户返回命令卡片视图
4. THE DeepClean_Page SHALL 保留 Mole 安装状态检测功能，WHEN Mole 未安装时展示安装引导界面
5. THE DeepClean_Page SHALL 保留 Mole 品牌展示区域，包含版本号和 GitHub 链接
6. WHEN Mole 未安装时，THE DeepClean_Page SHALL 禁用所有 Command_Card 的点击操作

### 需求 4：前后端通信协议

**用户故事：** 作为开发者，我希望前后端之间有清晰的通信协议，以便终端数据能可靠地双向传输。

#### 验收标准

1. THE PTY_Backend SHALL 通过 Tauri `invoke` 命令暴露以下接口：创建 PTY 会话（`pty_spawn`）、向 PTY 写入数据（`pty_write`）、调整 PTY 窗口大小（`pty_resize`）、关闭 PTY 会话（`pty_kill`）
2. THE PTY_Backend SHALL 通过 Tauri 事件通道发送以下事件：PTY 输出数据事件（`pty-output`，包含会话标识符和输出字节）、PTY 退出事件（`pty-exit`，包含会话标识符和退出码）
3. WHEN `pty_write` 被调用时，THE PTY_Backend SHALL 将原始字节数据写入对应会话的 PTY，不做任何转义或编码转换
4. WHEN `pty_resize` 被调用时，THE PTY_Backend SHALL 更新对应 PTY 会话的窗口行列数，使 TUI 程序能正确重绘界面

### 需求 5：Rust 后端模块简化

**用户故事：** 作为开发者，我希望移除 `deepclean.rs` 中不再需要的 GUI 扫描/执行函数，因为所有 Mole 交互将通过嵌入式终端完成。

#### 验收标准

1. THE PTY_Backend SHALL 替代 `deepclean.rs` 中的 `mole_clean_scan`、`mole_clean_execute`、`mole_purge_scan`、`mole_purge_execute`、`mole_analyze` 函数及其对应的 Tauri 命令
2. THE PTY_Backend SHALL 替代 `main.rs` 中的 `mole_open_terminal` 命令，因为终端交互将在应用内完成
3. THE deepclean 模块 SHALL 保留 `check_mole` 函数和 `MoleStatus` 结构体，用于检测 Mole 安装状态
4. THE deepclean 模块 SHALL 移除 `CleanCategory`、`CleanResult`、`PurgeItem`、`AnalyzeEntry`、`AnalyzeResult`、`MoleScanProgress` 等不再使用的数据结构
5. THE 前端 store（`src/stores/deepclean.ts`）SHALL 简化为仅保留 Mole 安装状态相关的状态管理，移除扫描结果、清理结果等不再需要的状态

### 需求 6：跨平台兼容性

**用户故事：** 作为 StowMind 用户，我希望嵌入式终端在 macOS、Windows 和 Linux 上都能正常工作。

#### 验收标准

1. THE PTY_Backend SHALL 在 macOS 和 Linux 上使用 Unix PTY 接口创建伪终端会话
2. THE PTY_Backend SHALL 在 Windows 上使用 ConPTY 接口创建伪终端会话
3. THE PTY_Backend SHALL 在创建 PTY 会话时继承当前系统的 PATH 环境变量，确保 `mo` 命令可被找到
4. IF 当前平台不支持 PTY 功能，THEN THE DeepClean_Page SHALL 显示提示信息并提供回退方案（在系统终端中打开命令）
