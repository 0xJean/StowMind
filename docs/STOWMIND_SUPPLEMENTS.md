# StowMind Supplement 能力边界

日期：2026-05-20

`StowMind supplement` 用于补齐 Mole 暂未暴露 CLI / JSON 的产品体验缺口。它不是 Mole 原生能力，代码、返回值和 UI 文案必须明确标注。

## 当前补全项

| 能力 | 位置 | 说明 |
|---|---|---|
| Analyze 移入废纸篓 | `src-tauri/src/stowmind_supplements/safe_trash.rs` | Mole 尚未暴露安全删除 CLI / JSON；StowMind 只移动到系统废纸篓 / 回收站，不使用 `rm`。 |
| 执行后对比回填 | `src/lib/stowmind-supplements/reconciliation.ts` | Mole Console 暂无结构化执行结果；StowMind 用执行前后 dry-run / list / health 对比做估算或状态对比。 |
| App 更新扫描 | `src-tauri/src/stowmind_supplements/app_updates.rs`、`src/lib/stowmind-supplements/appUpdates.ts` | Mole 尚未暴露 App Store / Sparkle / Electron 更新扫描 CLI / JSON；StowMind supplement 扫描本机应用元数据，macOS 尝试 Sparkle appcast 对比，Windows 先做注册表库存，不把未知状态伪装成已确认更新。 |
| 清理活动摘要 | `src/lib/stowmind-supplements/cleanupActivity.ts` | Mole 暂无统一 activity log / 累计清理量 JSON；StowMind 只汇总本地历史和统计，用于 HUD、首页和侧边栏角标。 |
| 卸载洞察提示 | `src/lib/stowmind-supplements/uninstallInsights.ts` | Mole 暂无细粒度卸载报告 JSON；StowMind 只给残留类型、外置盘、个人数据风险和厂商卸载器提示，不执行删除。 |

## 规则

- Mole 暴露同等 CLI / JSON 后，应优先切换回 Mole-backed 实现。
- Supplement 返回值必须带 `source = stowmind_supplement`。
- UI 文案必须写明“补全 / 对比 / 估算”，不能写成 Mole 原生执行报告。
- 删除类 supplement 只能走系统废纸篓 / 回收站，不允许直接永久删除。
- 高风险清理、卸载、优化执行仍优先走 Mole Console。
