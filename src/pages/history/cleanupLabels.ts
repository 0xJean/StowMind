import type { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import type { HistoryRecord } from '@/stores/app'

export function cleanupHistorySizeLabel(record: HistoryRecord, t: ReturnType<typeof useI18n>['t']) {
  if (!record.cleanupSummary || record.type === 'optimize' || record.type === 'system-cache') return null
  const summary = record.cleanupSummary
  const size = summary.totalSize
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return t('history.spaceUnknown')
  const key = summary.action === 'preview' ? 'history.spacePotential'
    : summary.sizeKind === 'reported_freed' ? 'history.spaceFreed'
    : summary.sizeKind === 'processed' ? 'history.spaceProcessed' : 'history.spaceEstimated'
  return t(key, { size: formatFileSize(size) })
}
