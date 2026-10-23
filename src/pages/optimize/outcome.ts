import type { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { useAppStore } from '@/stores/app'
import type { MoleOptimizeHealth, MoleOptimizeExecuteOutcome } from './types'

export function canExecuteOptimize(data: MoleOptimizeHealth) {
  return data.preview_status === 'complete' && typeof data.planned_count === 'number'
    && Number.isSafeInteger(data.planned_count) && data.planned_count > 0
}
export function recordOptimizeExecution(result: MoleOptimizeExecuteOutcome, t: ReturnType<typeof useI18n>['t'], interruption?: string) {
  const state = useAppStore.getState()
  const timestamp = new Date().toISOString()
  const count = typeof result.applied_count === 'number' && Number.isSafeInteger(result.applied_count) && result.applied_count >= 0 ? result.applied_count : null
  const executed = count !== null && count > 0
  const outcome = interruption ? executed ? 'partial' : 'unknown' : count === null ? 'unknown'
    : count === 0 ? result.summary_status === 'partial' ? 'failed' : 'skipped'
      : result.summary_status === 'complete' ? 'success' : 'partial'
  state.addHistory(createCleanupHistoryRecord({
    type: 'optimize', target: t('optimize.title'), label: t('history.type.optimize'),
    itemCount: count, totalSize: null, sizeKind: 'unknown', action: 'execute', executed, outcome, timestamp,
    errors: interruption ? [t(interruption === 'cancelled' ? 'maintenance.cancelled' : interruption === 'timeout' ? 'maintenance.timeout' : 'maintenance.failed')] : outcome !== 'success' && outcome !== 'skipped' ? [t('optimize.executeUnknown')] : undefined,
  }))
  if (!executed) return
  state.updateStatistics({
    cleanOperationCount: (state.statistics.cleanOperationCount ?? 0) + 1, lastCleaned: timestamp,
  })
}
