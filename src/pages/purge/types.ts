export interface MolePurgeItem {
  path: string
  size: number | null
}

export interface MolePurgePreview {
  root: string
  requested_root: string
  include_empty: boolean
  items: MolePurgeItem[]
  total_size: number | null
  size_kind: 'estimated' | 'at_least' | 'unknown'
  scan_status: 'complete'
  review_token: string | null
}

export interface MolePurgeOutcome {
  item_count: number | null
  total_size: number | null
  size_kind: 'reported_freed' | 'estimated' | 'at_least' | 'unknown'
  outcome: 'completed' | 'incomplete' | 'no_candidates' | 'cancelled' | 'failed' | 'unknown'
  raw_output: string
}

export interface PurgeScope {
  path: string
  includeEmpty: boolean
}

export function scopeKey(scope: PurgeScope) {
  return `${scope.path.trim()}::include-empty=${scope.includeEmpty}`
}

/** Native authorization is process-local and must never be restored from disk. */
export function cacheablePurgePreview(preview: MolePurgePreview): MolePurgePreview {
  return { ...preview, review_token: null }
}

export function isPurgePreview(value: unknown): value is MolePurgePreview {
  if (!value || typeof value !== 'object') return false
  const preview = value as MolePurgePreview
  return typeof preview.root === 'string' && typeof preview.requested_root === 'string'
    && typeof preview.include_empty === 'boolean' && preview.scan_status === 'complete'
    && (preview.review_token === null || typeof preview.review_token === 'string')
    && ['estimated', 'at_least', 'unknown'].includes(preview.size_kind)
    && (preview.total_size === null || isCount(preview.total_size))
    && Array.isArray(preview.items) && preview.items.every((item) => item && typeof item.path === 'string' && (item.size === null || isCount(item.size)))
}

export function canExecutePurge(preview: MolePurgePreview | null, scope: PurgeScope, fresh: boolean) {
  return Boolean(preview && fresh && preview.scan_status === 'complete' && preview.items.length > 0
    && preview.review_token && preview.requested_root === scope.path.trim()
    && preview.include_empty === scope.includeEmpty)
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Only execution evidence is counted; preview estimates are deliberately absent. */
export function purgeOutcomeMetrics(outcome: MolePurgeOutcome) {
  const recognized = outcome.outcome === 'completed' || outcome.outcome === 'incomplete'
    || outcome.outcome === 'no_candidates' || outcome.outcome === 'cancelled'
  const itemCount = recognized && isCount(outcome.item_count) ? outcome.item_count : null
  const reportedSize = recognized && isCount(outcome.total_size) ? outcome.total_size : null
  const freedBytes = recognized && outcome.size_kind === 'reported_freed' && isCount(outcome.total_size) ? outcome.total_size : null
  const hasEvidence = (itemCount ?? 0) > 0 || (freedBytes ?? 0) > 0
  return {
    hasEvidence,
    historyOutcome: !hasEvidence
      ? outcome.outcome === 'failed' ? 'failed' as const : itemCount === null && freedBytes === null ? 'unknown' as const : 'skipped' as const
      : outcome.outcome === 'incomplete' || outcome.outcome === 'cancelled' ? 'partial' as const : 'success' as const,
    itemCount,
    reportedSize,
    freedBytes,
    sizeKind: !recognized ? 'unknown' as const : outcome.size_kind === 'reported_freed' ? 'reported_freed' as const
      : outcome.size_kind === 'estimated' || outcome.size_kind === 'at_least' ? 'estimated' as const : 'unknown' as const,
  }
}
