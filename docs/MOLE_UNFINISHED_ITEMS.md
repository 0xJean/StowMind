# Mole 未完成项清单

日期：2026-05-20
对照来源：`https://mole.fit/zh/`、`https://mole.fit/llms.txt`、`https://mole.fit/llms-full.txt`

本文只记录还没有对齐 Mole 官网完整能力的部分，不重复已完成项。
产品边界更新：清理是核心，AI 文件整理是特色子功能；核心清理优先 Mole-backed，Mole Console 保留。若 Mole 尚未暴露 CLI / JSON，允许在独立 `StowMind supplement` 层补全，并在 UI / 注释 / 返回值中明确标注不是 Mole 原生能力。

## 当前结论

StowMind 已经有了 Mole 的主干入口，本轮继续补齐了能在 Mole-backed 边界内完成的可视化：

1. `Status` 已补健康评分解释、进程类型图标、Mole 原生状态因子说明。
2. `HUD` 已补菜单栏活动帧、CPU alert 通知、防抖和 HUD 内告警条。
3. `Doctor` 已补 Mole check 原生分区、helper/log/config/system 细节、近期失败线索。
4. `CLI-only` 命令已在 Mole Map 补动作说明，仍只跳转 Mole Console。
5. `Analyze` 已补 treemap、目录钻取、24 小时缓存、强制重扫、外置盘入口、右键菜单、权限重试和 StowMind supplement 移入废纸篓。
6. `Clean / Uninstall / Optimize` 已补 StowMind supplement 执行前后对比回填；Mole 原生结构化执行报告仍等待 Mole 暴露。
7. `Settings` 已补 Mole 系统设置分区、StowMind 登录启动真实开关、Full Disk Access 状态探测和 HUD 菜单栏显示项控制；Mole 未暴露的删除模式 / 许可证等仍以控制台或官网入口承接。
8. 官网 Mac App 提到的 App 更新扫描尚未由 Mole CLI / JSON 暴露；当前 `Software Update` 已补能力探测，并新增 StowMind supplement 元数据扫描作为过渡。
9. Windows 兼容已补应用内验证报告和清单入口，但仍需要 Windows 实机跑完整 smoke test。
10. `Uninstall` 已补 StowMind supplement 非破坏性洞察：残留类型、外置盘、个人数据风险和厂商卸载器提示。
11. `HUD / Home / Sidebar` 已补基于本地历史的累计清理量、最近清理活动和清理角标；Mole 原生活动日志仍待暴露。

## 未完成项

| 优先级 | 模块 | 当前状态 | 未完成内容 |
|---|---|---|---|
| P0 | Analyze | 已有 treemap、目录钻取、24 小时缓存、强制重扫、外置盘入口、右键菜单、权限重试、Mole Console 审查入口和 StowMind supplement 移入废纸篓 | Mole 原生右键删除仍需 Mole 暴露安全 CLI/JSON 后替换 supplement |
| P0 | App 更新扫描 | 已补能力探测和 StowMind supplement 元数据扫描 | Mole 原生 App Store / Sparkle / Electron 更新扫描仍需 Mole 暴露 CLI / JSON；当前 supplement 仅做本机元数据识别和 Sparkle appcast 对比，不伪装成 Mole 原生报告 |
| P0 | Settings | 已有整理 / AI 配置 + Mole 系统设置分区，StowMind 登录启动可真实读写，Full Disk Access 可探测，HUD 菜单栏显示项可控制 | Mole Mac App 独有的许可证状态、缓存删除模式真实状态仍未被 CLI 暴露；高风险项仍需 Mole Console / Mole App |
| P1 | Clean | 有 dry-run 预览、Console 执行闭环、返回刷新、StowMind supplement 前后对比估算和历史/统计回填 | Mole 原生真实释放值仍需 Mole 暴露结构化结果 |
| P1 | Uninstall / Optimize | 有只读页、控制台入口、返回刷新、StowMind supplement 前后对比、历史/统计回填和卸载洞察提示 | Mole 原生执行结果、风险项原因、残留明细和原生输出还需 Mole 暴露结构化结果 |
| P1 | HUD / 累计清理 | 已有独立 popover、托盘入口、指标控制、CPU alert、活动帧、累计清理量和侧边栏角标 | Mole 原生菜单栏奔跑动画、原生活动日志和清理进度流仍需 Mole 暴露或后续实机适配 |
| P2 | Windows 兼容 | 已有应用内兼容报告 | `mo.cmd`、脚本查找、路径分隔、安装脚本、控制台交互仍需 Windows 实机完整验证 |

## 本周优先开发顺序

1. 等 Mole 暴露 App 更新扫描的 CLI / JSON / 脚本能力后，把 StowMind supplement 扫描切回 Mole-backed 原生实现。
2. 等 Mole 暴露安全删除入口后，用 Mole-backed 右键删除替换 Analyze 的 StowMind supplement。
3. 等 Mole 暴露执行结果结构化输出后，用 Mole 原生报告替换 Clean / Uninstall / Optimize 的 StowMind supplement 前后对比估算。
4. 等 Mole 暴露删除模式、许可证状态等 CLI / JSON 后再做 Settings 真实状态；当前不做假开关。
5. 在 Windows 实机上跑完整 smoke test，并把验证结果写回应用内兼容报告。

## 不做项

- 不自研一套新的清理引擎。
- 不在核心清理路径里直接写 `rm` 式删除逻辑；StowMind supplement 删除只允许走系统废纸篓 / 回收站。
- 不移除 Mole Console。
- 不把 AI 文件整理和 Mole 清理混成同一条产品线。

## 验收口径

当以下内容都完成时，才算接近 Mole 全量对齐：

- 官网列出的五个主工具都有对应页面。
- CLI 专属命令都有清晰的控制台或可视化入口。
- 关键设置项能在 StowMind 中找到，且高风险动作仍保留系统设置或 Mole Console 跳转。
- 清理、卸载、优化的高风险动作仍由 Mole 自己确认和执行。
- Windows 下的命令发现和执行链路可复现、可验证。
