# AGENTS

- 尽量保持单文件不超过 500 行代码；如果继续新增功能会明显超过 500 行，应优先拆分，而不是继续堆在同一个文件里。
- 允许少量例外，例如自动生成文件、协议/类型定义汇总文件、确实难以拆开的超强内聚文件；但这类文件也应尽量控制，并在评审时说明原因。
- 拆分时优先按职责拆分：把类型定义、状态管理、UI 渲染、事件处理、平台/IO 适配分到不同文件，而不是随意切块。
- 如果一个文件同时承担多种职责，或已经变得难读、难测、难改，即使还没到 500 行，也应该提前拆分。
- 对于有多数据源或者多个相同业务的外部依赖情况：应采用优秀的适配器/抽象工厂模式。避免大量的if,else

## iPhone 主屏幕整理（强制）

- 修改 iOS 整理功能前，必须先阅读 [`docs/IOS_HOME_SCREEN_ORGANIZER.md`](docs/IOS_HOME_SCREEN_ORGANIZER.md)。
- “绝不删除 App”是不可关闭的系统约束；禁止删除、卸载、从主屏幕移除、隐藏页面、隐藏 App、重置布局或修改组件。
- Swift helper 不能自动长按 App 图标；识别不唯一、窗口移动、权限不足或出现删除菜单时必须暂停。
- AI 只能提供分类建议，不能提交坐标或输入事件；Rust 后端必须对计划和反序列化结果执行白名单校验。
- 修改后必须运行该文档规定的前端、Rust、Swift 和 Tauri 资源验证；完成验证前不得改版本号、创建标签或发布。

## 发布流程（强制）

- 任何 GitHub Release、发布标签、DMG 构建或已有版本资产替换前，必须先完整阅读并遵循 [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md)。
- 正式 macOS 产物只能通过文档规定的 GitHub Actions 发布流程构建、签名、公证和上传，禁止手工上传本地 DMG。
- 禁止发布 ad-hoc、未签名、未公证或未 staple 的 macOS 产物；发布后必须从 GitHub Release 独立下载并完成验收。
- 不得绕过 `production-release` Environment 人工审批、`protect-release-tags` 标签保护或文档规定的安全门。
- 第三方 GitHub Actions 必须固定到完整 commit SHA；默认禁止重写已经发布的 tag。
