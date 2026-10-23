import { formatFileSize } from '@/lib/utils'
import type { useI18n } from '@/i18n'
import type { MoleCleanPreview, MoleCleanSection } from './types'

type Translate = ReturnType<typeof useI18n>['t']
export type CleanSizeKind = 'exact' | 'at_least' | 'details' | 'unknown'

export function validCleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Detail rows are partial observations, never a replacement for Mole's total. */
export function summarizeCleanSection(section: MoleCleanSection) {
  const rows = section.items.filter((item) => item.status === 'dry_run')
  const sizes = rows.map((item) => validCleanNumber(item.size)).filter((value): value is number => value !== null)
  const counts = rows.map((item) => validCleanNumber(item.count)).filter((value): value is number => value !== null)
  return {
    size: sizes.length ? sizes.reduce((sum, value) => sum + value, 0) : null,
    count: counts.length ? counts.reduce((sum, value) => sum + value, 0) : null,
    rowCount: section.items.length,
  }
}

export function getCleanPreviewSummary(preview: MoleCleanPreview) {
  const sections = preview.sections.map(summarizeCleanSection)
  const sizes = sections.flatMap((section) => section.size === null ? [] : [section.size])
  const counts = sections.flatMap((section) => section.count === null ? [] : [section.count])
  const detailSize = sizes.length ? sizes.reduce((sum, size) => sum + size, 0) : null
  const detailCount = counts.length ? counts.reduce((sum, count) => sum + count, 0) : null
  const reportedSize = validCleanNumber(preview.potential_space)
  const reportedCount = validCleanNumber(preview.item_count)
  const reportedCategories = validCleanNumber(preview.category_count)
  const recognized = preview.summary_status === 'exact' || preview.summary_status === 'at_least'
  const contradictory = (reportedSize === 0 && (detailSize ?? 0) > 0)
    || (reportedCount === 0 && (detailCount ?? 0) > 0)
  const trustedSize = recognized && !contradictory ? reportedSize : null
  const size = trustedSize ?? detailSize
  const sizeKind: CleanSizeKind = trustedSize !== null
    ? preview.summary_status as 'exact' | 'at_least'
    : detailSize !== null ? 'details' : 'unknown'
  const count = reportedCount !== null && !(reportedCount === 0 && (detailCount ?? 0) > 0)
    && (recognized || reportedCount > 0) ? reportedCount : detailCount
  const detailCategories = preview.sections.filter((section) => section.items.some((item) => item.status === 'dry_run')).length
  const categories = reportedCategories !== null && (recognized || reportedCategories > 0)
    && !(reportedCategories === 0 && detailCategories > 0) ? reportedCategories : detailCategories || null
  const complete = preview.scan_status === 'complete'
  const canClean = complete && recognized && !contradictory && trustedSize !== null
    && reportedCount !== null && reportedCategories !== null && (trustedSize > 0 || reportedCount > 0)
  return {
    size, sizeKind, count, categories, canClean,
    empty: complete && recognized && !contradictory && reportedSize === 0 && reportedCount === 0,
    needsRescan: !complete || !recognized || contradictory || trustedSize === null
      || reportedCount === null || reportedCategories === null,
  }
}

export function formatCleanSize(value: number | null, kind: CleanSizeKind, t: Translate) {
  if (value === null || kind === 'unknown') return t('clean.summary.unknown')
  const size = formatFileSize(value)
  if (kind === 'at_least') return t('clean.summary.atLeast', { size })
  if (kind === 'details') return t('clean.summary.detailsSize', { size })
  return size
}

export function cleanPreviewLabels(preview: MoleCleanPreview, t: Translate) {
  const summary = getCleanPreviewSummary(preview)
  return {
    ...summary,
    sizeLabel: formatCleanSize(summary.size, summary.sizeKind, t),
    countLabel: summary.count ?? t('clean.summary.unknown'),
    categoriesLabel: summary.categories ?? t('clean.summary.unknown'),
  }
}
