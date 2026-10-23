import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { useAppStore } from '@/stores/app'
import type { MoleInstallerExecuteOutcome } from './types'

function knownMetric(value: number | null): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Native partial reports include only installers confirmed absent after deletion. */
export function recordInstallerOutcome(outcome: MoleInstallerExecuteOutcome, title: string, label: string, note: string) {
  const state = useAppStore.getState()
  const timestamp = new Date().toISOString()
  const reportedCount = knownMetric(outcome.item_count)
  const itemCount = outcome.status === 'unknown' || (outcome.status === 'failed' && reportedCount !== 0)
    ? undefined : reportedCount
  const measuredSize = knownMetric(outcome.total_size)
  const totalSize = itemCount === undefined || (itemCount === 0 && measuredSize !== 0) ? undefined : measuredSize
  const failedCount = knownMetric(outcome.failed_count)
  const hasExecutionEvidence = (outcome.status === 'success' || outcome.status === 'partial') && (itemCount ?? 0) > 0
  const completeReport = outcome.status === 'success' && itemCount !== undefined && totalSize !== undefined
  const record = createCleanupHistoryRecord({
    type: 'installer', target: title, label,
    itemCount, totalSize,
    action: 'execute', executed: hasExecutionEvidence,
    outcome: outcome.status === 'success' ? itemCount === 0 ? 'skipped' : itemCount === undefined ? 'unknown' : 'success' : outcome.status,
    // Mole sums the pre-deletion stat sizes, rounded up to KiB per file.
    // Those are processed file bytes, including in a fully successful run.
    sizeKind: totalSize !== undefined ? 'processed' : 'unknown',
    errors: completeReport || !note ? undefined : [note], timestamp,
  })
  if (record.cleanupSummary) record.cleanupSummary.failedCount = failedCount
  state.addHistory(record)
  if (!hasExecutionEvidence) return
  const statistics = state.statistics
  state.updateStatistics({
    cleanItemsRemoved: (statistics.cleanItemsRemoved ?? 0) + itemCount!,
    cleanOperationCount: (statistics.cleanOperationCount ?? 0) + 1,
    lastCleaned: timestamp,
  })
}
