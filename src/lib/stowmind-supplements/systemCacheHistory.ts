import type { SystemCacheCleanupOutcome, SystemCacheReport } from '@/pages/system-cache/types'
import { type CacheMeasurementHistory, type HistoryRecord, type Statistics, useAppStore } from '@/stores/app'

function measurement(report: SystemCacheReport): CacheMeasurementHistory {
  const sizeKnown = report.status === 'complete'
    && typeof report.size_bytes === 'number' && Number.isFinite(report.size_bytes)
    && report.size_bytes >= 0
  return {
    status: report.status,
    // An explicitly absent target is a known zero-sized observation. The
    // backend deliberately leaves size_bytes null for all non-complete scans.
    sizeBytes: report.status === 'not_found' ? 0 : sizeKnown ? report.size_bytes : null,
    scannedAt: report.scanned_at,
    modifiedAt: report.modified_at,
    authorized: report.authorized,
    message: report.message,
  }
}

function observedDelta(outcome: SystemCacheCleanupOutcome) {
  const before = measurement(outcome.before).sizeBytes
  const after = measurement(outcome.after).sizeBytes
  const delta = outcome.measured_delta_bytes
  return before !== null && after !== null && typeof delta === 'number' && Number.isFinite(delta) ? delta : null
}

export function createSystemCacheHistoryRecord(
  outcome: SystemCacheCleanupOutcome,
  label: string
): HistoryRecord {
  const successful = outcome.attempted && outcome.success
  const timestamp = new Date(outcome.completed_at * 1000).toISOString()
  return {
    id: `${Date.now()}-system-cache-${Math.random().toString(36).slice(2, 8)}`,
    type: 'system-cache',
    timestamp,
    directory: outcome.before.path,
    totalFiles: successful ? 1 : 0,
    categories: successful ? { [label]: 1 } : {},
    executed: successful,
    moves: [],
    cleanupSummary: {
      action: 'execute',
      itemCount: successful ? 1 : 0,
      skippedCount: outcome.attempted ? 0 : 1,
      errors: outcome.errors.length ? [...outcome.errors] : undefined,
      outcome: successful ? 'success' : outcome.attempted ? 'failed' : 'skipped',
      systemCache: {
        targetId: outcome.before.target_id,
        path: outcome.before.path,
        source: 'mole',
        attempted: outcome.attempted,
        before: measurement(outcome.before),
        after: measurement(outcome.after),
        observedDeltaBytes: observedDelta(outcome),
        moleMessage: outcome.before.mole_message,
      },
    },
  }
}

export function systemCacheStatisticsUpdate(
  outcome: SystemCacheCleanupOutcome,
  statistics: Statistics
): Partial<Statistics> {
  if (!outcome.attempted || !outcome.success) return {}
  const delta = observedDelta(outcome)
  const measured = typeof delta === 'number' && Number.isFinite(delta)
  return {
    systemCacheCleanupCount: (statistics.systemCacheCleanupCount ?? 0) + 1,
    systemCacheItemsRemoved: (statistics.systemCacheItemsRemoved ?? 0) + 1,
    systemCacheObservedBytes: (statistics.systemCacheObservedBytes ?? 0) + (
      measured ? Math.max(0, delta) : 0
    ),
    systemCacheMeasuredRuns: (statistics.systemCacheMeasuredRuns ?? 0) + (measured ? 1 : 0),
    lastSystemCacheCleanup: new Date(outcome.completed_at * 1000).toISOString(),
  }
}

export function recordSystemCacheCleanup(outcome: SystemCacheCleanupOutcome, label: string) {
  // Read state when the operation completes so concurrent maintenance work is
  // not overwritten by a stale render's statistics snapshot.
  const store = useAppStore.getState()
  store.addHistory(createSystemCacheHistoryRecord(outcome, label))
  if (outcome.attempted && outcome.success) {
    store.updateStatistics(systemCacheStatisticsUpdate(outcome, useAppStore.getState().statistics))
  }
}
