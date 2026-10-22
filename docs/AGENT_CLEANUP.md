# Agent Cleanup

Agent Cleanup is a StowMind supplement for reclaiming disposable files left by local coding agents. It is separate from Mole because Mole does not expose a structured Agent cache/worktree cleanup API.

## Scan and retention rules

The scanner uses a fixed allowlist of leaf paths for Codex, OpenCode, Claude Code, Kiro, Devin, Cursor, Windsurf, Gemini CLI / Antigravity, Continue, GitHub Copilot CLI, Amazon Q Developer, Cline, and Goose. It does not recursively inspect an agent home, project directory, browser profile, or the whole macOS Application Support tree. The current allowlist covers:

- Codex and Claude Code cache, debug, paste-cache, shell-snapshot, and registered worktree roots under the agent home.
- OpenCode CLI cache/log roots and the cache/log leaves of its desktop application.
- Kiro's default `$TMPDIR/kiro-log` CLI log directory, plus Kiro, Devin, Cursor, Windsurf, and Antigravity macOS Application Support cache/log leaves. Devin's CLI cache and log roots are also included.
- Gemini CLI / Antigravity CLI logs and crash reports, Continue's rebuildable code index and Chromium utility cache, GitHub Copilot CLI and macOS Copilot logs/marketplace cache, and Amazon Q's default `$TMPDIR/qlog` logs.
- Cline's `~/.cline/data/logs` and Goose's CLI/macOS application log directories. These are treated as logs because they can contain prompts, code snippets, or tool output and are never silently removed.
- Crashpad `pending` directories for desktop agents are scanned entry by entry so retention is applied to each dump. A directory that exceeds the bounded scan budget is represented by one protected marker; a partial scan can never produce executable cleanup items.
- The current Git repository and repositories directly under the allowlisted Agent worktree roots are checked for Codex's `refs/codex/turn-diffs/*` refs and unreachable Git objects. Ref entries are listed individually; unreachable objects are summarized as one bounded item with an object count and byte estimate.
- Claude and Codex application logs under `~/Library/Logs`.

Aider, Roo Code, Tabnine, and Ollama are intentionally not included in this allowlist. Their useful data is either stored inside project directories, mixed with sessions/configuration, or belongs to a model runtime rather than an Agent cache. They can be added later when an independent, documented cache or log leaf is available.

Only entries older than the selected retention period are suggested. The preview groups entries by agent and category (`cache`, `log`, `temporary`, `orphan_worktree`, `codex_internal_ref`, and `git_unreachable_object`) and marks protected entries separately. Very large aggregate directories report that at least 100,000 entries were inspected instead of expanding every child into the preview. The UI defaults to 30 days; the native command caps the value at 3,650 days.

The scanner always protects configuration, credentials, browser state, session data, generated images, lock and PID files, nested sensitive descendants, and every allowlisted item while the corresponding Agent process is running. A worktree is considered orphaned only when its `.git` link is stale or it is no longer present in Git's `worktree list --porcelain` output. Normal and registered worktrees stay protected.

Git metadata follows stricter rules than ordinary cache files. Codex refs are eligible only when no supported Agent or Git process is running, the ref is older than the retention period, and no Git lock is present. Execution carries the previewed ref object ID into `git update-ref -d`, so a ref changed after the preview fails closed. Unreachable objects are eligible only when the repository has no tracked changes, no Agent or Git process is active, and the object store is older than the retention period. Reflog expiry and object pruning use the configured retention cutoff rather than `now`; they are never selected by bulk selection and require a second explicit confirmation.

## Shared system cache detection

Agent scans also start a separate, read-only check of the macOS iconservices cache
at `/Library/Caches/com.apple.iconservices.store`. The shared system cache card
reports its own measurement or access error even when the Agent scan fails. It
does not attribute the cache or its growth to any Agent.

The system cache is excluded from Agent cleanup items, default selection, bulk
selection, retention rules, and the Agent cleanup size. Clearing the Agent
selection or changing its retention period never authorizes system-cache removal.

The card reuses the [system cache diagnostics](SYSTEM_CACHE_DIAGNOSTICS.md)
workflow: separate administrator review, explicit confirmation, scoped Mole
cleanup, and a follow-up measurement. Results use the existing system-cache
history and statistics rather than Agent cleanup totals. Opening or rescanning
Agent Cleanup does not request administrator access or delete the system cache.

## Execution safety

The preview is advisory. Before execution, the native command:

1. Requires an explicit confirmation flag from the UI.
2. Rechecks every selected item against the same fixed allowlist and retention policy.
3. Rejects symlinks, paths outside the allowlist, newly changed items, active state, and registered worktrees.
4. Moves approved filesystem paths to the operating system Trash or Recycle Bin through the shared StowMind safe-trash adapter.

Codex refs are removed with `git update-ref -d` after revalidation. An explicitly selected unreachable-object item first expires reflogs and then runs `git gc --prune=now`; this is a Git-native, irreversible operation and is blocked while the repository is dirty or locked.

The command never calls `rm` or permanently deletes a selected filesystem path. Git object pruning is the one explicit irreversible exception and is opt-in. A second scan after execution refreshes the preview so entries changed while the confirmation dialog was open are skipped safely. Every execution is recorded in the StowMind history and statistics, including successful items, skipped items, errors, category counts, and the Git pruning risk note.

The API responses identify this behavior with `source = stowmind_supplement`. If Mole later exposes an equivalent structured capability, this supplement should be replaced or routed through that Mole API.
