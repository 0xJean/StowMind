import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { useAppStore } from '@/stores/app'
import type { MoleInstallerExecuteOutcome } from './types'

/** Only a complete native execution report may contribute released bytes. */
export function recordInstallerOutcome(outcome: MoleInstallerExecuteOutcome, title: string, label: string, note: string) {
  const state = useAppStore.getState()
  const timestamp = new Date().toISOString()
  const confirmed = outcome.status === 'success' && outcome.item_count !== null && outcome.total_size !== null
  const hasExecutionEvidence = (outcome.item_count ?? 0) > 0
  state.addHistory(createCleanupHistoryRecord({
    type: 'installer', target: title, label,
    itemCount: outcome.item_count, totalSize: outcome.total_size,
    action: 'execute', executed: hasExecutionEvidence,
    outcome: outcome.status === 'success' && outcome.item_count === 0 ? 'skipped' : outcome.status,
    sizeKind: confirmed ? 'reported_freed' : 'unknown',
    errors: confirmed ? undefined : [note],
    skippedCount: outcome.failed_count ?? undefined, timestamp,
  }))
  if (!confirmed || (outcome.item_count ?? 0) === 0) return
  const statistics = state.statistics
  state.updateStatistics({
    cleanItemsRemoved: (statistics.cleanItemsRemoved ?? 0) + outcome.item_count!,
    cleanSizeFreed: (statistics.cleanSizeFreed ?? 0) + outcome.total_size!,
    reportedFreedBytes: (statistics.reportedFreedBytes ?? 0) + outcome.total_size!,
    cleanOperationCount: (statistics.cleanOperationCount ?? 0) + 1,
    lastCleaned: timestamp,
  })
}
