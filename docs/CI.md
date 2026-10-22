# Pull request checks

`.github/workflows/pr-checks.yml` runs on every pull request targeting `main`
and on pushes to `main`. There are no path filters or optional job conditions:
both required checks must report a result even for documentation-only changes.

| Check | Runner | Validation |
| --- | --- | --- |
| `frontend` | Ubuntu 24.04 | pnpm frozen-lockfile install, all frontend tests, TypeScript and Vite production build |
| `macos` | macOS 15 | Frontend assets, Rust formatting/check/tests with the Cargo lockfile, Swift safety evidence, debug Tauri App signing and resources, bundled helper's arm64/x86_64 architectures |

Node uses the supported 22 LTS major and pnpm uses the project's 8.15.5 version.
Third-party Actions are pinned to complete commit SHAs. Workflows use read-only
repository access, do not retain checkout credentials, and do not receive release
signing or notarization secrets. Only pushes to `main` save the Rust build cache.
An updated PR cancels its previous run.

The debug App follows [the iOS validation rules](IOS_HOME_SCREEN_ORGANIZER.md).
Without a development certificate the build explicitly uses ad-hoc signing for
the local debug App. It does not generate a DMG or publish artifacts. The
production release workflow and its approval environment remain separate.

## Required checks on main

After the workflow has reported successful `frontend` and `macos` checks, set
these exact names as required status checks in the existing `main` branch
protection rule. Bind both to the GitHub Actions app and require the branch to be
up to date before merging. Keep the existing PR requirement, administrator
enforcement, and force-push/deletion restrictions.

Do not rename either job without coordinating the branch protection settings.
Do not add workflow-level path filters that would leave required checks pending.
If a merge queue is introduced, also add the `merge_group` trigger.

## Reproduce locally

```bash
pnpm install --frozen-lockfile
node --test scripts/*.test.mjs
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
bash scripts/test-ios-helper-evidence.sh
IOS_HELPER_ARCHS=universal pnpm tauri:build:ios-debug
lipo 'src-tauri/target/debug/bundle/macos/StowMind Dev.app/Contents/Resources/binaries/stowmind-ios-helper' -verify_arch arm64 x86_64
```

The Rust, Swift, and App resource checks require macOS. Frontend tests run without
Tauri, a real iPhone, or system permissions. The Swift evidence tests use fixtures;
building the helper does not execute any iPhone input operation.
