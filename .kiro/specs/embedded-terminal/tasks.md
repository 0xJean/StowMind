# 实施计划：嵌入式终端

## 概述

将 StowMind 深度清理页面从 GUI 包装 Mole CLI 输出的方式，重构为内嵌 PTY 终端方案。后端使用 `portable-pty` 管理伪终端会话，前端使用 xterm.js 渲染终端，DeepCleanPage 重构为命令卡片 + 终端面板布局。

## 任务

- [x] 1. 添加依赖并创建 PTY 后端模块
  - [x] 1.1 在 `src-tauri/Cargo.toml` 中添加 `portable-pty` 依赖，在 `package.json` 中添加 `xterm` 和 `@xterm/addon-fit` 依赖
    - 在 `[dependencies]` 中添加 `portable-pty = "0.8"`
    - 在 `dependencies` 中添加 `"xterm": "^5.3.0"` 和 `"@xterm/addon-fit": "^0.10.0"`
    - _需求: 1.1, 2.1, 2.7_

  - [x] 1.2 创建 `src-tauri/src/pty.rs`，实现 `PtyManager` 结构体和 `pty_spawn` 命令
    - 定义 `PtySession` 结构体（writer + child）
    - 定义 `PtyManager` 结构体（sessions HashMap + next_id AtomicU32）
    - 实现 `PtyManager::new()`
    - 实现 `pty_spawn` Tauri 命令：创建 PTY pair → 构建 CommandBuilder → spawn 子进程 → 启动 tokio 读取线程（base64 编码 → emit `pty-output`）→ 读取结束时 emit `pty-exit` → 返回会话 ID
    - 定义 `PtyOutput` 和 `PtyExit` 事件 payload 结构体
    - _需求: 1.1, 1.2, 1.3, 1.5, 1.7, 4.1, 4.2, 6.1, 6.2, 6.3_

  - [x] 1.3 在 `src-tauri/src/pty.rs` 中实现 `pty_write`、`pty_resize`、`pty_kill` 命令
    - `pty_write`：从 sessions 中查找会话，将数据原始写入 PTY stdin，不做转义
    - `pty_resize`：从 sessions 中查找会话，调用 PTY master resize
    - `pty_kill`：从 sessions 中移除会话，终止子进程，释放资源
    - 所有命令对无效会话 ID 返回 `Err(String)`
    - _需求: 1.4, 1.6, 4.1, 4.3, 4.4_

  - [ ]* 1.4 为 PtyManager 编写属性测试（proptest）
    - **属性 1：会话 ID 唯一性**
    - **验证需求: 1.1**

  - [ ]* 1.5 为已终止会话编写属性测试（proptest）
    - **属性 3：已终止会话的操作拒绝**
    - **验证需求: 1.6**

  - [ ]* 1.6 为 pty_write 输入数据完整性编写属性测试（proptest）
    - **属性 4：输入数据完整性**
    - **验证需求: 4.3**

- [x] 2. 检查点 — 确保 Rust 后端编译通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 3. 简化后端 deepclean 模块并更新 main.rs
  - [x] 3.1 简化 `src-tauri/src/deepclean.rs`
    - 保留 `MoleStatus`、`check_mole()`、`current_platform()`、`mo_cmd()`、`extract_version()`
    - 移除 `strip_ansi`、`mo_command`、`CleanCategory`、`CleanResult`、`PurgeItem`、`AnalyzeEntry`、`AnalyzeResult`、`MoleScanProgress`
    - 移除 `mole_clean_scan`、`mole_clean_execute`、`mole_purge_scan`、`mole_purge_execute`、`mole_analyze`
    - 移除 `parse_clean_output`、`parse_purge_output`、`parse_freed_space`、`parse_name_size`
    - _需求: 5.1, 5.3, 5.4_

  - [x] 3.2 更新 `src-tauri/src/main.rs` 命令注册
    - 添加 `mod pty;` 声明
    - 在 `.invoke_handler` 中移除 `mole_clean_scan`、`mole_clean_execute`、`mole_purge_scan`、`mole_purge_execute`、`mole_analyze`、`mole_open_terminal`
    - 在 `.invoke_handler` 中添加 `pty_spawn`、`pty_write`、`pty_resize`、`pty_kill`
    - 添加 `.manage(pty::PtyManager::new())`
    - 保留 `mole_check` 命令
    - _需求: 5.1, 5.2_

- [x] 4. 检查点 — 确保后端编译通过且旧命令已移除
  - 确保所有测试通过，如有问题请询问用户。

- [x] 5. 创建前端 TerminalPanel 组件
  - [x] 5.1 创建 `src/components/TerminalPanel.tsx`
    - 接收 `command: string` 和 `onClose: () => void` props
    - 挂载时：创建 xterm.js Terminal + FitAddon → open → fit → 获取 cols/rows
    - 解析 command 字符串为命令和参数，调用 `invoke("pty_spawn", { command, args, cols, rows })`
    - 监听 `pty-output` 事件：base64 解码 → `terminal.write(Uint8Array)`
    - 监听 `pty-exit` 事件：在终端显示退出提示
    - 注册 `terminal.onData` → `invoke("pty_write", { id, data })`
    - 注册 ResizeObserver → `fitAddon.fit()` → `invoke("pty_resize", { id, cols, rows })`
    - 卸载时：调用 `invoke("pty_kill", { id })`，取消事件监听，销毁 Terminal
    - 处理 `pty_spawn` 失败：显示错误信息和重试按钮
    - 引入 xterm.css 样式
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.4_

  - [ ]* 5.2 为 base64 编解码往返一致性编写属性测试（fast-check）
    - **属性 2：PTY 输出数据传输完整性（往返属性）**
    - **验证需求: 1.3, 2.2**

- [x] 6. 重构 DeepCleanPage 和 deepclean store
  - [x] 6.1 简化 `src/stores/deepclean.ts`
    - 保留 `MoleStatus` 接口、`moleStatus`、`moleChecked`、`setMoleStatus`
    - 移除 `CleanCategory`、`PurgeItem`、`CleanResult`、`AnalyzeEntry`、`AnalyzeResult` 接口
    - 移除 `tab`、`cleanItems`、`purgeItems`、`cleanResult`、`purgeResult`、`analyzePath`、`analyzeResult`、`scanLog` 及其 setter
    - _需求: 5.5_

  - [x] 6.2 重写 `src/pages/DeepCleanPage.tsx`
    - 定义 `PageView = 'cards' | 'terminal'` 状态和 `activeCommand` 状态
    - 保留 Mole 安装检测逻辑（`invoke("mole_check")`）
    - 保留 Mole 未安装时的安装引导界面
    - 保留 `MoleBrand` 组件（版本号 + GitHub 链接）
    - 实现 8 个命令卡片网格：`mo`、`mo clean`、`mo purge`、`mo analyze`、`mo optimize`、`mo uninstall`、`mo status`、`mo installer`
    - 每个卡片使用 lucide-react 图标（Terminal、Trash2、FolderX、HardDrive、Zap、PackageX、Activity、Download）
    - Mole 未安装时禁用所有卡片
    - 点击卡片 → 切换到终端视图，渲染 TerminalPanel
    - 终端视图提供关闭按钮返回卡片视图
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 6.3 为 Mole 未安装时的 UI 状态编写属性测试（fast-check）
    - **属性 5：Mole 未安装时的 UI 状态一致性**
    - **验证需求: 3.4, 3.6**

- [x] 7. 更新 i18n 国际化字符串
  - [x] 7.1 更新 `src/i18n/zh.ts` 和 `src/i18n/en.ts`
    - 添加命令卡片标题和描述的 i18n key（`deepclean.cmd.mo`、`deepclean.cmd.clean` 等）
    - 添加终端面板相关 i18n key（`deepclean.terminal.close`、`deepclean.terminal.exited`、`deepclean.terminal.spawnFail`、`deepclean.terminal.retry` 等）
    - 移除不再使用的旧 i18n key（`deepclean.tabClean`、`deepclean.tabPurge`、`deepclean.tabAnalyze`、`deepclean.scanClean`、`deepclean.executeClean` 等扫描/执行相关 key）
    - _需求: 3.1, 3.2_

- [x] 8. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选，可跳过以加快 MVP 进度
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点任务确保增量验证
- 属性测试使用 proptest（Rust）和 fast-check（TypeScript）
- 单元测试验证具体示例和边界情况
