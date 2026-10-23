# Maintenance task lifecycle

Application inventory, uninstall previews/execution, and optimization
previews/execution use the same native task manager. Each invocation has a
unique `runId` owned by its Tauri window. `maintenance_cancel` accepts that
identifier; another window cannot cancel the task.

## Deadlines and cancellation

| Invocation | Total deadline |
| --- | --- |
| Application inventory | 90 seconds |
| Uninstall or optimization preview | 180 seconds |
| Uninstall or optimization execution | 600 seconds |

An execution deadline includes inventory validation and the native preflight;
it does not restart for each subprocess. Cancellation stops remaining work.
Completed removals or optimization actions are not rolled back.

The native runner drains both output streams with bounded retained output.
Stopping a task escalates from termination to forced termination and reaps the
owned process before releasing its reservation. A direct child exiting does
not prove completion while its descendants are still running or holding the
output streams. If exit cannot be confirmed, the reservation remains busy and
another cancellation request can retry recovery.

Process supervision currently supports Unix platforms. Unsupported platforms
reject these operations before starting a maintenance process.

The interface keeps cancellation pending until the native acknowledgement and
the original invocation settle. Leaving a kept-alive route or unmounting its
page cancels its active task. Native window closure also requests cancellation.
Late results must not restore an old preview or enable a new execution.

## Interrupted results

Failures include a typed reason, retained output, and a truncation indicator.
Only the actual execution stage may attach a parsed partial result. Inventory
and preflight output cannot be recorded as completed cleanup.

History separates successful, partial, failed, skipped, and unknown outcomes.
Preview estimates and operation progress never replace missing execution
counts or bytes. Moving files to Trash and Git object-size changes are
processed sizes, not measurements of physical disk space freed. Only an
explicit freed-space report contributes to the confirmed cumulative counter;
older unverified history is retained without treating it as confirmed freed
space.

Purge and installer cleanup separately require their native, single-use
review tokens. Those tokens are not persisted in the result cache. Changing
scope, file identity, or the selected Mole runtime requires another preview.

## Validation

Regression tests use temporary fixtures and harmless subprocesses rather than
uninstalling applications, optimizing the host, or deleting user data. Run the
complete checks in [CI.md](CI.md), including the native lifecycle tests, before
shipping changes to this contract.
