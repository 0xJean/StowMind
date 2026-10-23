import type { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import type { HistoryRecord } from '@/stores/app'

export interface ProcessedSizeTotal {
  bytes: number
  hasKnownSize: boolean
  incomplete: boolean
  unspecified: boolean
}

/** Aggregate recorded work independently from physical space freed. */
export function addProcessedSize(current: ProcessedSizeTotal | undefined, record: HistoryRecord): ProcessedSizeTotal {
  const total = current ?? { bytes: 0, hasKnownSize: false, incomplete: false, unspecified: false }
  if (!record.executed || record.undone) return total
  const summary = record.cleanupSummary
  const kind = summary?.processedSizeKind
  const value = summary?.processedSize ?? (summary?.sizeKind === 'processed' ? summary.totalSize : undefined)
  const validKind = kind === undefined || kind === 'reported' || kind === 'at_least' || kind === 'partial' || kind === 'unspecified'
  const known = validKind && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    && Number.isSafeInteger(total.bytes + value)
  return {
    bytes: total.bytes + (known ? value : 0),
    hasKnownSize: total.hasKnownSize || known,
    incomplete: total.incomplete || !known || kind === 'at_least' || kind === 'partial',
    unspecified: total.unspecified || kind === 'unspecified',
  }
}

export function processedSizeTotalLabel(total: ProcessedSizeTotal | undefined, t: ReturnType<typeof useI18n>['t']) {
  if (!total?.hasKnownSize || (total.incomplete && total.bytes === 0)) return null
  return t(total.incomplete ? 'history.spaceProcessedAtLeast'
    : total.unspecified ? 'history.spaceProcessedUnspecified' : 'history.spaceProcessed', {
    size: formatFileSize(total.bytes),
  })
}
