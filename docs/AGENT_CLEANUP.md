# Agent Cleanup

Agent Cleanup is a StowMind supplement for reclaiming disposable files left by local coding agents. It is separate from Mole because Mole does not expose a structured Agent cache/worktree cleanup API.

## Scan and retention rules

The scanner uses a fixed allowlist of leaf paths for Codex, OpenCode, Claude Code, Kiro, Devin, Cursor, and Windsurf. It does not recursively inspect an agent home, project directory, browser profile, or the whole macOS Application Support tree. The current allowlist covers:

- Codex and Claude Code cache, debug, paste-cache, shell-snapshot, and registered worktree roots under the agent home.
- OpenCode CLI cache/log roots and the cache/log leaves of its desktop application.
- Kiro's default `$TMPDIR/kiro-log` CLI log directory, plus Kiro, Devin, Cursor, and Windsurf macOS Application Support cache/log leaves. Devin's CLI cache and log roots are also included.
- Crashpad `pending` directories for desktop agents are scanned as one bounded temporary-file item, so a crash-report backlog is visible without rendering millions of individual files.
- Claude and Codex application logs under `~/Library/Logs`.

Only entries older than the selected retention period are suggested. The preview groups entries by agent and category (`cache`, `log`, `temporary`, and `orphan_worktree`) and marks protected entries separately. Very large aggregate directories report that at least 100,000 entries were inspected instead of expanding every child into the preview. The UI defaults to 30 days; the native command caps the value at 3,650 days.

The scanner always protects configuration, credentials, browser state, session data, generated images, lock and PID files, nested sensitive descendants, and every allowlisted item while the corresponding Agent process is running. A worktree is considered orphaned only when its `.git` link is stale or it is no longer present in Git's `worktree list --porcelain` output. Normal and registered worktrees stay protected.

## Execution safety

The preview is advisory. Before execution, the native command:

1. Requires an explicit confirmation flag from the UI.
2. Rechecks every selected item against the same fixed allowlist and retention policy.
3. Rejects symlinks, paths outside the allowlist, newly changed items, active state, and registered worktrees.
4. Moves approved paths to the operating system Trash or Recycle Bin through the shared StowMind safe-trash adapter.

The command never calls `rm` or permanently deletes a selected path. A second scan after execution refreshes the preview so entries changed while the confirmation dialog was open are skipped safely.

The API responses identify this behavior with `source = stowmind_supplement`. If Mole later exposes an equivalent structured capability, this supplement should be replaced or routed through that Mole API.
