import type { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import type { HistoryRecord } from '@/stores/app'

export function cleanupHistorySizeLabel(record: HistoryRecord, t: ReturnType<typeof useI18n>['t']) {
  if (!record.cleanupSummary || record.type === 'optimize' || record.type === 'system-cache') return null
  const summary = record.cleanupSummary
  const size = summary.totalSize
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return summary.processedSizeKind === 'partial'
    ? t('history.spaceProcessedPartial') : t('history.spaceUnknown')
  const key = summary.action === 'preview' ? 'history.spacePotential'
    : summary.sizeKind === 'reported_freed' ? 'history.spaceFreed'
    : summary.sizeKind === 'processed' ? summary.processedSizeKind === 'at_least' ? 'history.spaceProcessedAtLeast'
      : summary.processedSizeKind === 'unspecified' ? 'history.spaceProcessedUnspecified' : 'history.spaceProcessed'
      : 'history.spaceEstimated'
  return t(key, { size: formatFileSize(size) })
}

export function cleanupHistoryProcessedLabel(record: HistoryRecord, t: ReturnType<typeof useI18n>['t']) {
  const summary = record.cleanupSummary
  if (!summary || summary.sizeKind === 'processed') return null
  if (summary.processedSizeKind === 'partial') {
    return summary.totalSize === undefined ? null : t('history.spaceProcessedPartial')
  }
  if (summary.processedSize === undefined) return null
  return cleanupHistorySizeLabel({ ...record, cleanupSummary: { ...summary, totalSize: summary.processedSize, sizeKind: 'processed' } }, t)
}

export function cleanupHistoryCountLabel(record: HistoryRecord, t: ReturnType<typeof useI18n>['t']) {
  if ((record.type ?? 'organize') === 'organize') return t('history.nFiles', { n: record.totalFiles })
  const summary = record.cleanupSummary
  return t(summary?.itemCountSource === 'operation_log' ? 'history.operationRecords' : 'history.nItems', {
    n: summary?.itemCount ?? t('clean.summary.unknown'),
  })
}

export function cleanupHistoryOperationLabels(record: HistoryRecord, t: ReturnType<typeof useI18n>['t']) {
  const summary = record.cleanupSummary
  if (!summary || summary.operationLogStatus !== 'available') return []
  const labels: string[] = []
  if (summary.operationCount !== undefined && summary.itemCountSource !== 'operation_log') {
    labels.push(t('history.operationRecords', { n: summary.operationCount }))
  }
  if ((summary.failedCount ?? 0) > 0) labels.push(t('history.failedRecords', { n: summary.failedCount! }))
  return labels
}
