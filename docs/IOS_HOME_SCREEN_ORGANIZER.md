# StowMind iPhone 主屏幕安全整理

本文档是 iOS 主屏幕整理功能的安全与实现约束。任何修改
`src-tauri/src/ios/`、`src-tauri/ios-helper/` 或 `/ios-organize` 页面前，都必须先阅读本文档。

## 产品边界

- 仅支持 macOS 上的 Apple `iPhone Mirroring`。
- iPhone 必须满足 Apple 的镜像连接条件，并保持锁定。
- 首发是辅助执行，不提供无人值守的全自动整理。
- Windows、Linux、iPad、MDM 和后台执行不在首发范围。
- iOS 27 Beta 仅作实验支持，正式兼容目标是当前稳定版 macOS/iOS。

## 不可关闭的安全规则

以下行为永远不能由 StowMind 生成或发送：

- 删除或卸载 App。
- 从主屏幕移除 App。
- 隐藏页面、隐藏 App 或重置主屏幕布局。
- 修改组件、隐藏区或 App 资源库中的布局。

`IosOperation` 只能包含 `MoveApp`、`CreateFolder`、`RenameFolder` 和
`MoveToDock`。如果未来增加操作类型，必须同时增加反序列化拒绝测试、计划校验测试和
人工验收，不得依赖提示词约束。

## 数据与 AI

- OCR 和图标识别只在本机 Swift helper 内存中处理。
- 原始截图不得写入 SQLite、应用数据目录、日志、历史记录或远程请求。
- 数据库只保存结构化快照、计划和会话；快照中的 `windowBounds` 仅用于检测窗口移动。
- 远程 AI 只能收到 App 名称、规则分类和目标模板，不能收到截图、图标二进制、设备标识或
  任何原始视觉数据。
- AI 只负责分类建议。Rust 规则和安全校验负责决定是否能生成动作以及动作的坐标范围。
- 金融、钱包、密码、身份验证等敏感 App 默认保护；组件页面、文件夹内 App 和低置信度
  识别结果也不自动移动。

## 镜像执行规则

1. Rust 在执行前读取已保存快照，验证计划来源、App 身份、坐标、置信度、模板和保护集合。
2. Swift helper 每个动作前重新截图，检查镜像窗口边界、编辑模式、来源 App 唯一性和
   OCR 置信度。
3. 不自动长按 App 图标。没有确认的安全空白区时，要求用户在镜像中手动进入编辑模式。
4. 每批最多 3 个动作。每批后重新截图并校验窗口和可观测 App 集合。
5. 检测到中英文删除、移除、隐藏或重置菜单时，只发送 Escape 关闭菜单，不点击任何菜单项，
   并暂停会话。
6. 镜像窗口被移动、缩放、遮挡、设备断开、截图失败或识别不唯一时，立即暂停或失败，
   不尝试猜测坐标。
7. `Cmd+Shift+Escape` 是全局紧急停止快捷键。停止后不得继续发送输入事件。

当前 helper 可以自动执行同一页面且满足置信度门槛的移动。跨页移动、创建文件夹、重命名
文件夹和 Dock 调整会进入人工引导或重新盘点路径，不能把失败重试当成自动完成。

## 原生实时预览与真实镜像交互

- macOS 的公开 API 不支持把另一个进程的 `NSWindow` 真正重挂载到 StowMind；禁止使用私有
  reparent API、透明窗口洞或持续 `AXRaise` 抢焦点来伪装嵌入。
- 只读预览模式使用持久 `SCStream` 捕获 `com.apple.ScreenContinuity` 的指定窗口。Swift
  helper 直接把 ScreenCaptureKit 返回的 IOSurface-backed `CMSampleBuffer` 交给
  Core Image / Metal，并绘制到一个无边框、鼠标穿透的原生 `NSPanel`。
- 预览帧不编码为 JPEG，不经过 Rust、IPC 或 WebView，不写入磁盘、数据库、日志、历史记录
  或远程请求。面板只在 StowMind 位于前台且 `/ios-organize` 页面可见时显示，离开页面后
  必须停止 `SCStream` 并销毁面板。
- 预览面板位于 StowMind 上方但不接受任何鼠标事件，因此点击 StowMind 控件不会遮住预览，
  也不会把输入转发到 iPhone。面板显隐必须使用 Tauri 主窗口报告的焦点状态，helper 保持
  `.prohibited` 且不得通过自身激活状态反推宿主焦点。面板位置只允许使用当前 StowMind
  主窗口编号和经过 Rust 范围校验的页面槽位；槽位或 StowMind 窗口移动只改变预览位置，
  不改变真实镜像窗口，也不会单独使布局快照失效。
- 实时预览只需要屏幕录制权限，不需要辅助功能权限。辅助功能权限仍只用于完整翻页盘点和
  经过安全校验的辅助执行。
- 需要用户直接操作 iPhone 时，必须切换到“真实镜像交互”模式：停止只读预览，激活 Apple
  `iPhone Mirroring`，并把 StowMind 临时缩为不重叠的独立伴随窗口。退出交互模式时恢复
  StowMind 原始尺寸和位置。
- 交互模式不使用 `CGEventPostToPid`，不转发鼠标、触控或键盘事件，也不生成长按。用户直接
  操作 Apple 窗口；StowMind 只显示状态、计划和允许的控制按钮。交互模式中禁止开始新的
  盘点、规划、执行或验证；只允许处理已经暂停的安全引导、暂停或取消现有会话。退出交互
  模式后，现有布局快照必须标记为过期并重新盘点，不能假设用户没有改变主屏幕。
- Apple 镜像窗口断开、ScreenCaptureKit 失败、窗口编号失效或预览区域越界时，停止预览并
  显示错误，不尝试猜测其他窗口或坐标。
- 页面只显示只读状态，不能提交任意坐标；实际操作仍必须提交 Rust 已保存并通过校验的
  `planId`。
- 缺少辅助功能或屏幕录制权限时，UI 必须提供对应系统设置页的一键跳转；后端只接受
  `accessibility` 和 `screenRecording` 两个白名单目标，不能打开前端提交的任意 URL。
- 权限按钮应先由当前运行构建调用系统原生请求 API；未授权时再打开对应设置页，避免用户
  误操作另一份同名 App。权限请求和设置跳转必须复用相同的白名单。

## 盘点范围

权限状态必须区分 `scanReady` 与 `executionReady`。当前可见页面的只读盘点只依赖镜像窗口、
ScreenCaptureKit 和 Vision，不得因为缺少辅助功能权限而禁用；完整盘点和辅助执行才需要
Swift helper 获得辅助功能权限。

辅助功能未就绪时，后端必须降级为当前可见页面截图识别，不能发送点击、滑动、键盘或拖拽
事件。辅助功能已就绪后，完整盘点可通过页面滑动访问主屏幕，并在识别到 App 资源库时尝试
打开搜索列表分页。搜索栏、页面或 OCR 识别不可靠时，快照会标记为
`inventoryComplete = false`；UI 必须显示范围，规划器不得把可见页面清单冒充完整设备清单。
单页或未遍历到 App 资源库边界的部分页面快照不得生成、恢复或执行全局整理方案。

App 身份优先使用 Bundle ID；当镜像只提供视觉文本时使用规范化名称，并把低置信度或
可能重复的结果降级为人工处理。名称 ID 不是 Bundle ID，不能用于宣称完整设备级唯一性。

## 恢复与历史

恢复不是反向猜测拖拽。流程必须重新扫描当前状态，对照执行前结构化快照生成新的计划，
再经过预览、确认、批量限制和执行后验证。App 集合不一致时禁止生成恢复计划。

历史记录只保存快照 ID、计划 ID 和会话 ID，不保存原始截图。

## 验证要求

```bash
pnpm build
pnpm build:ios-helper
cargo test --manifest-path src-tauri/Cargo.toml --locked
git diff --check
```

修改 Tauri 资源或 helper 构建时，还必须验证：

```bash
pnpm tauri:build:ios-debug
```

本地权限测试必须使用独立的 `StowMind Dev` / `com.stowmind.app.debug` 调试包，避免与
`/Applications/StowMind.app` 的正式授权项混淆。`pnpm tauri:build:ios-debug` 会让主 App
和 helper 优先使用同一个本机 `Apple Development`，其次使用 `Developer ID Application`
身份，以保持 macOS TCC 权限所依赖的 designated requirement 稳定。可通过
`STOWMIND_DEBUG_SIGNING_IDENTITY` 显式选择身份。

只有机器没有任何可用开发者证书时才允许回退 ad-hoc；构建日志必须明确警告此时每次重建都
可能需要重新授权。不得把 ad-hoc 调试包的权限失效误判成用户没有打开系统设置开关。首次从
ad-hoc 迁移到稳定签名后，需要在“录屏与系统录音”和“辅助功能”中对当前 `StowMind Dev`
关闭再打开一次；之后相同 Bundle ID、Team ID 和签名身份的重建不应重复迁移。

确认 helper 位于 `.app/Contents/Resources/binaries/`，是 `arm64 + x86_64` universal
binary。正式发布仍使用 `src-tauri/tauri.ios.conf.json`；主 App 和 helper 都必须是同一
Team ID 的 Developer ID 签名、非 ad-hoc，并通过公证和 Gatekeeper 验证。
