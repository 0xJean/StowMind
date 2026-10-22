# System cache diagnostics

System cache diagnostics lives in Doctor. The first adapter covers only
`/Library/Caches/com.apple.iconservices.store` on macOS. This is shared system
state, so it is separate from Agent Cleanup even when development tools may
contribute to its growth.

## Detection and authorization

- Ordinary detection is read-only and runs with the current user's permissions.
- Only a completed size probe produces a measured size. Permission denial,
  timeout, partial traversal, unsupported platforms, and other errors remain
  explicit states with an unknown size, rather than a zero-byte result.
- A 10 GiB threshold flags unusually large caches for review; it does not grant
  permission to delete them or establish why they grew.
- Administrator review uses a dedicated terminal session and the existing
  password interaction. Passwords are not written to diagnostic output or history.
- A completed administrator review returns an expiring, single-use token held
  in backend memory for ten minutes. Cleanup requires this token and explicit confirmation.
  The token is not persisted in application history.

## Mole execution

StowMind's diagnostic measurements are identified as `stowmind_supplement`.
The removal itself uses the selected Mole runtime's `safe_sudo_remove` function
and is identified as Mole execution. The adapter checks that the selected
runtime contains the iconservices rule and the required safety functions.
An incompatible runtime leaves diagnosis available and cleanup unavailable.
The reviewed runtime is bound to canonical library paths and content fingerprints;
changing or updating Mole requires another review before cleanup.

The target is fixed in the backend. Callers cannot submit another path or shell
command. The adapter checks path identity and rejects symlinks and stale review
results before execution. Mole's path protection and user whitelist remain in
effect. The Mole libraries run in a user shell; the adapter does not source
user-writable scripts as root, run the full system-clean command, or add a
parallel deletion implementation.

Some macOS installations have a writable `/Library/Caches` ancestor. Mole may
refuse privilege escalation below such a directory, or decline removal under its
whitelist or other guards. Administrator authentication does not override that
decision. The UI must show the refusal and the post-attempt measurement instead
of claiming that the cache was removed.

## Recheck and history

After a cleanup attempt, the adapter probes the same target again, including
when Mole refuses or fails. Cancellation and timeout are recorded as incomplete
operations, never as successful cleanup. A directory may be recreated by macOS
while it is being rechecked.

History records the target, timestamps, before/after measurement states, Mole
outcome, and errors. A before/after `du` difference is an observed cache-size
change, not proof of physically reclaimed disk space; unknown measurements stay
unknown. System-cache statistics preserve this distinction from other cleanup
space totals.

No administrator action is performed merely by opening Doctor. Tests use
temporary fixtures and mocked authorization/Mole execution; they must not remove
the development machine's real system cache.
