# StowMind GitHub Release Process

本文档是 StowMind 发布 GitHub Release 的唯一标准流程。任何正式版本、补丁版本、
预发布版本，以及对既有 Release 资产的替换，都必须先阅读并遵循本文档。

## 1. 强制原则

- 正式 macOS 产物只能由 `.github/workflows/publish.yml` 构建和上传。
- 包含 iPhone 整理功能时，发布产物还必须包含 `stowmind-ios-helper` universal helper；
  helper 必须与主 App 使用同一 Team ID 的 Developer ID 签名，不能是 ad-hoc。
- 禁止手工上传本地构建的 DMG 到 GitHub Release。
- 禁止发布 ad-hoc、无签名、未公证或未 staple 的 macOS 产物。
- 禁止绕过 `production-release` Environment 的人工审批。
- 禁止把证书、P12 密码、API Key 或 `.p8` 内容写入仓库、日志、Issue 或聊天。
- 第三方 GitHub Actions 必须固定到完整 commit SHA，不能只引用可移动 tag。
- 发布标签必须匹配 `v*`，并受仓库 `protect-release-tags` ruleset 保护。
- 正式修复默认发布新的语义化版本；普通发布拒绝覆盖公开 Release。明确授权的同版本替换只能走第 9 节的专用流程。
- 发布变更也必须通过 PR 合并到 `main`，并通过必需的 `frontend`、`macos` 检查；不能直接推送 `main` 绕过保护。
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
- `main` 合并要求：PR、GitHub Actions 的 `frontend` 与 `macos` 检查成功，并与最新 `main` 保持同步

PR 检查与正式发布是两套独立流程。`frontend`、`macos` 成功只代表变更验证通过，
不代表已构建、签名、公证或发布可下载版本；验证内容见 [CI 文档](CI.md)。

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
- 普通发布的目标 tag 尚未存在；同版本替换保留原 tag 并使用第 9 节的独立入口。

同时核对远端 ref，不能只查本地 tag：

```bash
git ls-remote origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
```

新版本要求没有输出。已存在但发布失败的 `v1.1.0` 仍应保留；发布后续新功能时
使用新的 MINOR 版本（本次为 `v1.2.0`），不能把旧标签移动到最新 `main`。

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
node --test scripts/*.test.mjs
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/publish.yml', aliases: true); puts 'workflow yaml ok'"
```

如果修改了 Tauri 配置、签名能力或平台代码，再运行：

```bash
pnpm tauri build --debug --bundles app
```

如果变更包含 iPhone 整理 helper，还必须先运行 `pnpm build:ios-helper`，并使用
`--config src-tauri/tauri.ios.conf.json` 验证 helper 已进入 app 资源目录。

所有失败必须解决。不能以“CI 可能会通过”为理由跳过本地失败。

### 4.5 Apple 公证服务预检与协议错误

正式构建前，工作流使用同一组公证 API 凭据执行只读预检：

```bash
node scripts/notarize-macos.mjs preflight
```

该命令调用 `notarytool history`，不提交产物，也不接受任何法律协议。它检查当前凭据
能否访问 Notary Service；成功不能替代后续实际提交的 `Accepted` 结果。
私钥只在受限权限的临时目录中使用，并在结束后清理，不得复制到仓库或打印内容。

若 Apple 返回 HTTP 403，且正文明确包含 required agreement missing/expired，
必须停止发布。2026 年的 `v1.1.0` 失败运行 `37268907664` 属于此类账户协议问题，
不能据此判定 Developer ID 签名损坏。由 Apple Developer 团队的 Account Holder
登录 [开发者账户](https://developer.apple.com/account/) 查看并处理待接受/过期协议，
确认使用正确团队且会员资格有效；其角色职责见 [Apple 官方说明](https://developer.apple.com/help/account/access/roles)。
不能用更换证书、关闭公证或重试上传来绕过协议要求，也不要把所有 403 都归为协议错误。

处理后重新运行只读预检，成功后才继续正式发布。若仍失败，保留已脱敏的状态码、
错误说明和 run 链接，排查 API Key 权限、团队及 Apple 服务状态；不要输出密钥。

## 5. 创建发布 PR 并合并

从已同步的 `main` 创建发布分支：

```bash
git switch -c codex/release-vX.Y.Z
```

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
git push -u origin codex/release-vX.Y.Z
gh pr create --base main --head codex/release-vX.Y.Z --fill
gh pr checks PR_NUMBER --required --watch
```

确认 PR 的必需检查 `frontend`、`macos` 均成功，分支与最新 `main` 同步，
并完成审阅后再合并。不能因为本地检查通过或发布已获授权而跳过 PR 检查。

合并后取回远端 `main`，确认发布提交和所有目标功能已包含其中：

```bash
git switch main
git pull --ff-only origin main
git status --short --branch
git rev-list --left-right --count origin/main...main
git log -1 --oneline
```

要求计数为 `0 0`、工作区干净；记录此时的 commit，作为标签和下载验收的预期 commit。

## 6. 创建并推送标签

正式版本使用 annotated tag：

```bash
git tag -a vX.Y.Z -m "StowMind vX.Y.Z"
git push origin refs/tags/vX.Y.Z
```

不要对新版本使用 lightweight tag。

tag 必须指向第 5 节已确认的远程 `main` commit。创建前再次确认目标 tag 不存在。
tag 推送会触发 `.github/workflows/publish.yml`；不要用旧 `v1.1.0` 的重跑代替新版本。

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

1. 检查标签、四处版本号、发布说明和所有签名与公证 Secrets。
2. 在安装前端依赖和构建前，以 `notarytool history` 预检 Apple 服务访问。
3. 安装冻结版本的前端依赖，构建 Intel + Apple Silicon universal macOS 应用和 iOS helper。
4. 使用 Developer ID Application 证书签名。
5. `codesign --verify --strict` 验证 nested iOS helper。
6. 检查主 App 和 helper 的 `Authority=Developer ID Application`。
7. 检查主 App 和 helper 的 `TeamIdentifier=H4NCLYWCAJ`。
8. 明确拒绝主 App 或 helper 的 `Signature=adhoc`。
9. `codesign --verify --deep --strict` 验证应用。
10. 使用专用 API Key 提交 Apple Notary Service，记录提交 ID。
11. 等待并确认明确的 `Accepted` 状态；非成功结果读取可用的公证日志并使工作流失败。
12. 对 DMG 执行 `stapler staple` 和 `stapler validate`。
13. 使用 Gatekeeper `spctl` 验证 DMG。
14. 收集与当前版本严格匹配的唯一 universal DMG，生成只包含其文件名的 `SHA256SUMS.txt`；不发布 `.app.tar.gz`。
15. 普通发布上传这两个资产并公开新 Release；同版本替换须额外满足第 9 节的备份、回滚和审计要求。

普通发布任一步骤失败都不得公开或保留本次新增的 Release 资产。草稿上传失败时
清理本次的不完整资产及本次新建草稿；普通 publisher 不处理公开版本替换。
第 9 节的专用替换失败时须保留旧资产、永久备份和恢复记录，并按专用恢复流程处理。

## 9. 已发布版本与同版本重发

普通 publisher 继续拒绝覆盖已公开的 Release。正式修复默认递增版本号，经 PR
验证后创建新标签并发布；不得删除公开版本或强制移动其标签来绕过检查。

用户或仓库所有者明确授权具体原因与范围后，可以使用经过独立评审和完整验证的
专用替换入口。首次授权范围为 `v1.2.0` 的清理统计、预览安全、扫描错误和卸载/优化
取消机制修复。执行前必须完整阅读 [同版本替换流程](RELEASE_REPLACEMENT.md)。

专用流程在同一个 `publish.yml` 中，通过 `workflow_dispatch` 明确指定新源码 SHA、
原 tag 对象、原 Release ID、两项旧附件 SHA256 和替换原因。原 tag 不移动；新源码
SHA 单独记录于发布说明与永久审计附件，不能把旧 tag 描述为新构建源码。
只有当前 `main` 的 `frontend`、`macos` 成功后才可构建，并保留 Environment 审批、
签名公证安全门、旧资产永久备份、失败回滚与独立下载验收。

GitHub 多附件改名不是原子操作；旧字节始终保留，异常需恢复旧名称与说明。
不可变 Release 不支持替换；不得关闭不可变保护或删除 Release 绕过限制。

## 10. 发布后独立验收

工作流成功不等于验收完成。必须重新从 GitHub Release 下载公开附件，不能复用本地
构建、CI 工作目录或此前下载的同名文件。PR 检查通过、tag 存在、草稿 Release 存在
都不等于公开下载已就绪。

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
helper="$app/Contents/Resources/binaries/stowmind-ios-helper"
codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -vv --type execute "$app"
codesign -dvvv --requirements - "$app" 2>&1
codesign --verify --strict --verbose=2 "$helper"
codesign -dvvv "$helper" 2>&1
lipo "$helper" -verify_arch arm64 x86_64
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist"

hdiutil detach "$mountpoint"
```

要求确认：

- `Identifier=com.stowmind.app`
- `TeamIdentifier=H4NCLYWCAJ`
- `Authority=Developer ID Application:`
- `source=Notarized Developer ID`
- 应用版本与 tag 一致
- 主 App 与 helper 均非 ad-hoc，helper 为 arm64/x86_64 universal

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
- 普通发布 tag 指向预期 commit；同版本替换保留原 tag，新构建 commit 必须匹配永久审计与明确指定的 `source_sha`。
- 本地工作区干净。

验收记录至少包含版本、tag 对应的 commit、发布工作流 run、公开下载链接、DMG SHA256、
stapler/Gatekeeper/签名/helper/版本检查结论。只有这些检查全部成功后，才向用户声明
该版本已签名、公证并可下载。失败时应报告具体阻塞，不得把旧版附件描述为本次新版。

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
