# Windows Mole 实机验证清单

日期：2026-05-20

StowMind 已经在代码层面兼容 Mole Windows 入口：后端命令使用 `mo.cmd`，脚本查找会覆盖 `windows/` 目录，Analyze 路径钻取兼容 `/` 和 `\`。但这不等于完成 Windows 实机验证。

## 必跑 smoke test

1. 安装 Mole Windows 版本，确认 `where mo.cmd` 能找到可执行入口。
2. 在 StowMind 的 Mole Console 中运行 `mo status`、`mo clean`、`mo uninstall`、`mo optimize`、`mo analyze`。
3. 在 Status / HUD 页面确认 `mo status -json` 可解析，HUD popover 可打开、隐藏、关闭后常驻托盘。
4. 在 Clean 页面运行 dry-run，进入 Mole Console 执行后返回，确认历史和统计能回填。
5. 在 Uninstall 页面刷新列表，选择应用进入 Mole Console，返回后确认列表刷新和执行记录可回填。
6. 在 Optimize 页面刷新 health / dry-run，进入 Mole Console 执行后返回，确认执行记录可回填。
7. 在 Analyze 页面扫描 `C:\Users\<user>`、外置盘或受限目录，确认右键菜单、权限重试和 Mole Console fallback 可用。
8. 在 Mole Map 页面确认 Windows 兼容报告显示 `mo.cmd`、PowerShell 和实机验证状态。

## 不通过时的处理口径

- Mole 命令不存在：先修 Mole 安装 / PATH，不在 StowMind 内兜底实现 Mole 功能。
- JSON 输出不稳定：保持 Console fallback，不在 StowMind 内自研扫描或清理逻辑。
- 权限或 UAC 弹窗失败：保留 Mole Console 原始交互，StowMind 只做提示和回跳。
