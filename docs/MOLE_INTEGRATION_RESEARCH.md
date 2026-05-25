# Mole 功能集成调研报告

调研日期：2026-05-18
更新日期：2026-05-19
对象：Mole 官网 `https://mole.fit/zh/`、Mole GitHub 项目、StowMind 当前代码与文档

## 结论摘要

StowMind 的新定位是“以清理和系统维护为核心，AI 文件整理作为特色子功能”。在这个定位下，Mole 不只是高级终端入口，而是核心清理能力来源。

当前原则已经收紧：

- 核心清理功能必须基于 Mole 的真实命令或脚本函数。
- StowMind 负责原生 UI、预览解析、确认、历史、统计和错误展示。
- StowMind 不自研一套清理/删除器，也不在核心清理路径中直接删除文件。
- 重复文件扫描不是 Mole 能力，只作为 StowMind 辅助检查工具保留，不包装成 Mole 清理，也不计入核心清理收益。
- Mole Console `/deepclean` 必须保留，继续支持 `mo`、`mo clean`、`mo uninstall`、`mo optimize`、`mo analyze`、`mo status`、`mo purge`、`mo installer`。

推荐路线：把高频清理做成 StowMind 原生页面，但底层继续调用 Mole；对 Mole 暂不适合包装的高权限/交互命令，继续通过 Mole Console 执行。

## Mole 功能拆解

| 模块 | Mole 能力 | 对 StowMind 的相关性 | 当前建议 |
|---|---|---:|---|
| 系统清理 | 清理系统缓存、应用日志、浏览器残留、开发工具缓存、AI 工具缓存等 | 高 | 原生页先做 `mo clean --dry-run` 预览，执行留在 Mole Console |
| 软件 / 应用更新 | 查看应用更新、管理应用、清理卸载残留 | 高 | 目前已拆出卸载与安装包清理，更新检查仍缺专页 |
| 应用卸载 | 卸载 App 并清理偏好设置、Launch Agents、Containers 等残留 | 中 | 第二阶段包装，优先保留 Console |
| 系统优化 | 重建 Quick Look、Spotlight、字体缓存、刷新 DNS 等 | 中 | 高级维护入口，优先保留 Console |
| 磁盘分析 | Treemap/目录占用分析，定位大文件 | 高 | 使用 `mo analyze -json <path>` 原生展示 |
| 系统状态 | CPU、内存、GPU、磁盘、网络、电池、温度等仪表盘 | 高 | 使用 `mo status -json` 驱动 Dashboard/Monitor |
| Doctor / 诊断 | 电池健康、低电量模式、常见系统问题检查 | 中 | 当前只在状态页做部分诊断提示，未做独立页 |
| 菜单栏 HUD | 菜单栏显示 CPU/内存/网速与快捷入口 | 中 | 资源监控成熟后评估 |
| 构建产物清理 | 清理 `node_modules`、`target`、`.build` 等项目产物 | 高 | 复用 Mole purge 脚本函数做预览和执行 |
| 安装包清理 | 查找 `.dmg`、`.pkg`、`.zip` 等安装包 | 高 | 复用 Mole installer 脚本函数做扫描和执行 |
| CLI 交互 | `mo` 交互式菜单与若干命令 | 高 | 保留为高级、兼容和排障入口 |

## StowMind 当前现状

已具备的非清理能力：

- AI 文件整理：扫描、规则优先分类、AI 辅助、预览、执行、历史、撤销。
- 整理安全策略：dry-run、执行前确认、部分成功保留、错误归类、移动前可选备份。
- 文件夹监视：监听目录变化并提示。
- 重复文件辅助检查：按大小分组后计算 SHA-256，只展示重复组。

已接入的 Mole 能力：

- `mo status -json`：Dashboard 真实系统状态来源。
- `mo analyze -json <path>`：磁盘分析原生页面来源。
- `mo clean --dry-run`：系统清理原生页面只读预览来源。
- Mole `purge.sh`：限定用户选择目录，做 dry-run 预览和 Mole purge 执行。
- Mole `installer.sh`：复用 installer 扫描函数和 `delete_selected_installers` 执行函数。
- Mole Console：保留终端方式执行完整 Mole 命令集。

当前边界：

- `mo clean` 执行仍保留在 Mole Console，因为它涉及全局清理、白名单、sudo 和 Mole 自身交互确认。
- Purge / Installer 的删除动作在 Mole 脚本函数内部完成；StowMind 只传路径和记录结果。
- 重复文件页只做扫描、选择和打开路径，不提供删除。
- 软件更新检查、Doctor 诊断、状态页里的 GPU / 温度 / 符号化折线图 / pin / sort 仍未完全覆盖。

## 集成方案

### 推荐方案：StowMind 原生 UI + Mole 能力适配器

做法：后端封装 Mole 命令或 Mole 脚本函数，前端展示为原生扫描结果、确认弹窗、历史和统计。

优点：

- 符合“清理功能基于 Mole”的产品边界。
- 用户体验比纯终端更清晰。
- 不需要维护一套平行清理规则。
- Mole Console 仍可作为高级和排障入口。

风险：

- 依赖 Mole 输出格式和脚本函数稳定性。
- 当 StowMind 以原生 UI 展示 Mole 结果时，仍需要承担预览、确认和错误说明责任。
- 对 TUI/交互命令要谨慎包装，必要时继续跳转 Console。

不采用：StowMind 自研核心清理器。构建产物、安装包、系统缓存、应用残留等清理不应由 StowMind 直接扫描后删除；如果 Mole 没有对应能力，应保持只读分析或辅助工具定位。

## 产品形态建议

建议导航分层：

- Mole 清理中心：系统清理、构建产物、安装包、磁盘分析、系统状态。
- Mole Console：完整命令集、高级功能、兼容入口、排障入口。
- 辅助工具：重复文件检查、大文件查看等只读能力。
- 特色能力：AI 文件整理，处理“不该删除但需要归档”的用户文件。

“原生”一词在产品和技术文档中应统一解释为 StowMind 原生页面和工作流，不表示 StowMind 自己实现清理删除逻辑。

## 安全与合规

- Mole 是 MIT 开源项目，当前 StowMind 声明为调用外部 CLI，不捆绑或修改源码。
- 如果未来捆绑 Mole 二进制，需要同步处理许可证、第三方声明、更新机制和安全审计。
- 所有核心清理执行必须能追溯到 Mole 命令或 Mole 脚本函数。
- StowMind 不提供自研废纸篓适配器或 `rm` 类执行路径作为核心清理能力。
- 系统目录、根目录、用户家目录顶层不应提供 StowMind 自行删除入口。
- 用户文件相关能力优先保持移动、归档、打开路径和解释，不直接建议删除。

## 技术落地建议

优先按职责拆分，避免把 Mole 适配继续堆在单个页面或单个 Rust 文件中：

- `src-tauri/src/mole_utils.rs`：Mole 命令定位、脚本定位、输出清理、单位转换。
- `src-tauri/src/mole_clean.rs`：`mo clean --dry-run` 预览解析。
- `src-tauri/src/deepclean.rs`：Mole 安装检测、状态、分析、purge 适配。
- `src-tauri/src/mole_installer.rs`：installer 扫描和执行适配。
- `src/pages/CleanPage.tsx`、`PurgePage.tsx`、`InstallerPage.tsx`、`AnalyzePage.tsx`：原生页面。

后续如果继续扩展，建议抽象为 `MoleCapabilityAdapter`，由不同能力模块声明：

- preview command/function
- execute command/function
- output parser
- risk level
- whether Console fallback is required

不要引入 `NativeCleanAdapter` 作为并行清理实现，以免偏离“清理基于 Mole”的边界。

## Mole 真实能力对接现状

本机 Mole 1.35.0 已确认：

- `mo status -json`：可输出结构化系统状态，适合直接接入 Dashboard/Monitor。
- `mo analyze -json <path>`：可输出结构化磁盘分析结果，已接入 Analyze 原生页面。
- `mo clean --dry-run`：可真实预览系统清理，当前已通过适配器解析分组文本输出，接入“系统清理”原生 dry-run 预览页。
- `mo purge --dry-run`：可真实预览构建产物清理；当前通过复用 Mole purge 脚本逻辑并限定 `PURGE_SEARCH_PATHS`，接入“构建产物”预览页。
- Mole purge 执行：当前通过 source `purge.sh`、设置 `PURGE_SEARCH_PATHS`、调用 `start_purge; perform_purge` 完成。
- `mo installer --dry-run`：公开 CLI 会进入选择型 TUI；当前通过 `MOLE_TEST_MODE=1` 复用 installer 扫描函数，接入“安装包”预览页。
- Mole installer 执行：当前会先重新运行 Mole installer 扫描，将用户选择路径与 Mole 扫描结果取交集，再调用 Mole `delete_selected_installers` 和 `show_summary`。删除动作仍在 Mole 函数内，且可执行对象必须来自 Mole 扫描结果。
- `mo uninstall --dry-run`、`mo optimize --dry-run`：适合第二阶段评估，优先保留 Console。

## 决策建议

建议采用“清理主线 Mole-backed + StowMind 原生体验”的策略：

1. 保留 Mole Console，并继续作为高权限和复杂交互命令的执行入口。
2. 优先把 `status`、`analyze`、`clean dry-run`、`purge`、`installer` 包装成稳定页面。
3. Purge / Installer 可以通过 Mole 脚本函数执行；System Clean 执行暂留 Console。
4. 重复文件保持辅助检查，不升级为删除功能，除非 Mole 后续提供对应能力。
5. AI 文件整理保留为特色能力，负责处理“不该删除但需要归档”的用户文件。

最终目标不是复制 CleanMyMac，而是用 Mole 承接系统清理能力，用 StowMind 承接理解、呈现、确认和整理工作流。
