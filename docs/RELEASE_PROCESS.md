# StowMind GitHub Release Process

本文档是 StowMind 发布 GitHub Release 的唯一标准流程。任何正式版本、补丁版本、
预发布版本，以及对既有 Release 资产的替换，都必须先阅读并遵循本文档。

## 1. 强制原则

- 正式 macOS 产物只能由 `.github/workflows/publish.yml` 构建和上传。
- 禁止手工上传本地构建的 DMG 到 GitHub Release。
- 禁止发布 ad-hoc、无签名、未公证或未 staple 的 macOS 产物。
- 禁止绕过 `production-release` Environment 的人工审批。
- 禁止把证书、P12 密码、API Key 或 `.p8` 内容写入仓库、日志、Issue 或聊天。
- 第三方 GitHub Actions 必须固定到完整 commit SHA，不能只引用可移动 tag。
- 发布标签必须匹配 `v*`，并受仓库 `protect-release-tags` ruleset 保护。
- 通常必须发布新的语义化版本。替换已经发布的标签仅用于明确批准的紧急修复。
- 如果本文档与工作流不一致，执行更严格的要求，并在同一变更中同步修正文档与工作流。

## 2. 当前安全配置

GitHub 仓库已经配置：

- Environment：`production-release`
- Required reviewer：`0xJean`
- 允许部署的 ref：
  - branch：`main`
  - tag：`v*`
- tag ruleset：`protect-release-tags`
- tag 创建、更新和删除仅允许仓库管理员绕过
- 正式发布 Job 权限：`contents: write`
- 发布并发锁：同一个 tag 不能并行发布
- Job 超时：60 分钟

`production-release` Environment 必须存在以下 Secrets：

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

不得把这些 Secrets 降级为普通仓库文件或命令行明文参数。

## 3. Apple 凭据与本地备份

当前发布身份：

- Bundle identifier：`com.stowmind.app`
- Team ID：`H4NCLYWCAJ`
- Developer ID certificate：StowMind Release CI 专用证书
- Certificate expiration：2027-02-01
- Notarization API Key ID：`XUYCMKL5K8`
- 本地 `asc` profile：`stowmind-release-ci`

本地备份：

- 加密 P12：`~/.config/stowmind/signing/stowmind-release-ci.p12`
- P12 密码：macOS Keychain
  - service：`com.stowmind.release-ci`
  - account：`p12-password`
- 公证 API Key：由 `asc` 存储在 macOS Keychain

维护要求：

- 至少在证书到期前 30 天开始轮换。
- 新证书必须属于同一 Team ID，并通过隔离 Keychain 的签名测试。
- 轮换后先更新 Environment Secrets，再发布新版本。
- 如果怀疑私钥泄露，立即停止发布、撤销对应凭据并重新签发。
- 不要删除 P12 备份，除非已建立新的加密备份并验证可恢复。

## 4. 发布前准备

### 4.1 确认仓库状态

```bash
git status --short --branch
git fetch origin --tags
git rev-list --left-right --count origin/main...main
```

要求：

- 工作区和暂存区干净。
- 本地 `main` 与 `origin/main` 同步。
- 不存在未审阅的本地提交。
- 目标 tag 尚未存在；同版本替换例外见第 9 节。

### 4.2 确定版本号

遵循语义化版本：

- `PATCH`：兼容性修复和小型问题修复。
- `MINOR`：向后兼容的新功能。
- `MAJOR`：破坏性变化。

版本必须同步到：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` 中的 `stowmind` package
- `src-tauri/tauri.conf.json`

检查示例：

```bash
rg -n '"version":|^version = ' \
  package.json \
  src-tauri/Cargo.toml \
  src-tauri/Cargo.lock \
  src-tauri/tauri.conf.json
```

### 4.3 编写发布说明

创建：

```text
.github/release-notes/vX.Y.Z.md
```

发布说明至少包含：

- 用户可感知的变化。
- 重要修复。
- 兼容性或迁移要求。
- 一次性权限迁移说明（如果适用）。

不得声称产物已签名或公证，除非发布工作流和发布后验收均成功。

### 4.4 运行发布前验证

```bash
git diff --check
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --locked
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/publish.yml', aliases: true); puts 'workflow yaml ok'"
```

如果修改了 Tauri 配置、签名能力或平台代码，再运行：

```bash
pnpm tauri build --debug --bundles app
```

所有失败必须解决。不能以“CI 可能会通过”为理由跳过本地失败。

## 5. 创建发布提交

只暂存与发布有关的文件：

```bash
git add \
  package.json \
  src-tauri/Cargo.toml \
  src-tauri/Cargo.lock \
  src-tauri/tauri.conf.json \
  .github/release-notes/vX.Y.Z.md
```

如果版本同时包含功能或修复代码，应按实际变更加入对应文件。

检查并提交：

```bash
git diff --cached --check
git diff --cached --stat
git commit -m "chore: release vX.Y.Z"
git push origin main
```

推送后再次确认：

```bash
git status --short --branch
git rev-list --left-right --count origin/main...main
```

## 6. 创建并推送标签

正式版本使用 annotated tag：

```bash
git tag -a vX.Y.Z -m "StowMind vX.Y.Z"
git push origin refs/tags/vX.Y.Z
```

不要对新版本使用 lightweight tag。

tag 推送会触发 `.github/workflows/publish.yml`。

## 7. 审批并监控发布

工作流会在 `production-release` Environment 等待人工批准。

优先在 GitHub Actions 页面确认：

- tag 和 commit 正确。
- 版本号正确。
- 发布说明存在。
- 没有意外代码被包含。

然后批准 Environment。

CLI 查看：

```bash
gh run list --workflow publish.yml --limit 10
gh run watch RUN_ID --exit-status --interval 15
```

如需通过 API 审批：

```bash
gh api repos/0xJean/StowMind/actions/runs/RUN_ID/pending_deployments
```

只有确认目标 commit 和 tag 正确后才可以提交 `approved` 状态。

## 8. CI 必须通过的安全门

发布工作流必须依次完成：

1. 检查所有签名与公证 Secrets 存在。
2. 安装冻结版本的前端依赖。
3. 构建 Intel + Apple Silicon universal macOS 应用。
4. 使用 Developer ID Application 证书签名。
5. `codesign --verify --deep --strict` 验证应用。
6. 检查 `Authority=Developer ID Application`。
7. 检查 `TeamIdentifier=H4NCLYWCAJ`。
8. 明确拒绝 `Signature=adhoc`。
9. 使用专用 API Key 提交 Apple Notary Service。
10. 等待公证成功。
11. 对 DMG 执行 `stapler staple` 和 `stapler validate`。
12. 使用 Gatekeeper `spctl` 验证 DMG。
13. 生成只包含文件名的 `SHA256SUMS.txt`。
14. 替换或创建 GitHub Release 资产。

任一步骤失败都不得发布或保留新的 Release 资产。

## 9. 替换已经发布的同版本

默认禁止重写已发布 tag。只有用户或仓库所有者明确要求，并确认这是紧急修复时才允许。

执行前必须：

- 记录替换原因。
- 保持四处版本号不变。
- 更新同一个 `.github/release-notes/vX.Y.Z.md`。
- 完整运行发布前验证。
- 确认旧资产将在新资产验证成功后被替换。

执行：

```bash
git tag -fa vX.Y.Z -m "StowMind vX.Y.Z" NEW_COMMIT
git push --force origin refs/tags/vX.Y.Z
```

远端 ruleset 会记录管理员绕过。随后仍必须完成 Environment 审批和全部发布后验收。

替换后必须向用户提供新的 DMG SHA256，并提醒删除可能被浏览器缓存的旧下载。

## 10. 发布后独立验收

工作流成功不等于验收完成。必须重新从 GitHub Release 下载公开附件。

```bash
tmp="$(mktemp -d)"
gh release download vX.Y.Z \
  --repo 0xJean/StowMind \
  --pattern "StowMind_X.Y.Z_universal.dmg" \
  --pattern "SHA256SUMS.txt" \
  --dir "$tmp"

(
  cd "$tmp"
  shasum -a 256 -c SHA256SUMS.txt
)
```

要求输出：

```text
StowMind_X.Y.Z_universal.dmg: OK
```

继续验证公证和 Gatekeeper：

```bash
dmg="$tmp/StowMind_X.Y.Z_universal.dmg"
xcrun stapler validate "$dmg"
spctl -a -t open --context context:primary-signature -vv "$dmg"
```

要求包含：

```text
accepted
source=Notarized Developer ID
```

挂载并验证应用：

```bash
mountpoint="$tmp/mount"
mkdir -p "$mountpoint"
hdiutil attach "$dmg" -mountpoint "$mountpoint" -nobrowse -readonly -noautoopen

app="$mountpoint/StowMind.app"
codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -vv --type execute "$app"
codesign -dvvv --requirements - "$app" 2>&1

hdiutil detach "$mountpoint"
```

要求确认：

- `Identifier=com.stowmind.app`
- `TeamIdentifier=H4NCLYWCAJ`
- `Authority=Developer ID Application:`
- `source=Notarized Developer ID`
- 应用版本与 tag 一致

最后检查公开 Release：

```bash
gh api repos/0xJean/StowMind/releases/tags/vX.Y.Z
git ls-remote origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
git status --short --branch
```

要求：

- Release 不是 draft。
- Release 不是 prerelease，除非本次明确发布预发布版本。
- DMG 和 `SHA256SUMS.txt` 均存在。
- tag 指向预期 commit。
- 本地工作区干净。

## 11. Full Disk Access 签名迁移

从旧 ad-hoc 构建迁移到 Developer ID 构建时，用户需要执行一次：

1. 安装正式签名的新 DMG。
2. 在 macOS 完全磁盘访问中删除旧 StowMind 条目。
3. 重新添加 `/Applications/StowMind.app`。
4. 开启权限并重启 StowMind。

之后只要继续使用同一 Team ID 的 Developer ID 身份签名，升级不应再使用每次变化的 ad-hoc 身份。

## 12. 禁止事项

- 不得使用 `gh release upload` 绕过发布工作流。
- 不得把本地未公证 DMG 当作正式附件。
- 不得临时关闭 Environment 审批以加快发布。
- 不得删除或弱化 `protect-release-tags` ruleset。
- 不得把 GitHub Actions 引用改回 `@v4`、`@v7` 等可移动 tag。
- 不得在日志中打印 Secret 值或完整私钥。
- 不得因“只是补丁”而跳过版本同步、测试、发布说明或发布后验收。
