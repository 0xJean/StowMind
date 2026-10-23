import type { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { useAppStore } from '@/stores/app'
import type { MoleUninstallItem, MoleUninstallOperationOutput } from './types'

type Translate = ReturnType<typeof useI18n>['t']
export const uninstallTargetKey = (item: MoleUninstallItem, permanent: boolean) => JSON.stringify([item.path, item.uninstall_name, permanent])
export function canExecuteUninstall(result: MoleUninstallOperationOutput | null, permanent: boolean) {
  return Boolean(result?.dry_run && result.permanent === permanent && result.item_count === 1)
}

export function recordUninstallExecution(result: MoleUninstallOperationOutput, item: MoleUninstallItem, t: Translate, interruption?: string) {
  if (result.dry_run) return
  const state = useAppStore.getState()
  const timestamp = new Date().toISOString()
  const count = typeof result.item_count === 'number' && Number.isSafeInteger(result.item_count) && result.item_count >= 0 ? result.item_count : null
  const bytes = typeof result.total_size === 'number' && Number.isSafeInteger(result.total_size) && result.total_size >= 0 ? result.total_size : null
  const executed = count !== null && count > 0
  const outcome = interruption ? executed ? 'partial' : 'unknown' : count === null ? 'unknown' : count === 0 ? 'skipped' : bytes === null ? 'partial' : 'success'
  state.addHistory(createCleanupHistoryRecord({
    type: 'uninstall', target: item.name, label: t('history.type.uninstall'),
    // Mole's "freed" text is the measured app/related-file counter minus
    // retained files. Permanent removal does not turn it into a disk delta.
    itemCount: count, totalSize: bytes, sizeKind: count === null || bytes === null ? 'unknown' : 'processed',
    action: 'execute', executed, outcome, timestamp,
    errors: interruption ? [t(interruption === 'cancelled' ? 'maintenance.cancelled' : interruption === 'timeout' ? 'maintenance.timeout' : 'maintenance.failed')] : outcome === 'unknown' || outcome === 'partial' ? [t('apps.summaryUnknown')] : undefined,
  }))
  if (!executed) return
  state.updateStatistics({
    cleanItemsRemoved: (state.statistics.cleanItemsRemoved ?? 0) + (count ?? 0),
    cleanOperationCount: (state.statistics.cleanOperationCount ?? 0) + 1,
    lastCleaned: timestamp,
  })
}
