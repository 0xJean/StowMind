import type { HistoryRecord, HistoryRecordType, Statistics } from '@/stores/app'

// StowMind supplement cleanup activity.
//
// Mole owns the cleanup engines. This module only summarizes StowMind's local
// history/statistics so HUD, Home, and Sidebar can show cumulative cleanup
// progress while Mole has no shared activity-log JSON API.

export const STOWMIND_SUPPLEMENT_ACTIVITY_SOURCE = 'stowmind_supplement'

export const CLEANUP_TYPES: HistoryRecordType[] = [
  'clean',
  'purge',
  'installer',
  'uninstall',
  'optimize',
  'agent-cleanup',
  'system-cache',
]

export interface CleanupActivitySummary {
  source: typeof STOWMIND_SUPPLEMENT_ACTIVITY_SOURCE
  totalFreed: number
  executedCount: number
  previewCount: number
  optimizedCount: number
  observedCacheReduction: number
  latest?: HistoryRecord
  latestExecuted?: HistoryRecord
  recent: HistoryRecord[]
}

export function buildCleanupActivitySummary(
  history: HistoryRecord[],
  statistics: Statistics
): CleanupActivitySummary {
  const cleanup = history.filter((record) => isCleanupType(record.type ?? 'organize'))
  const executed = cleanup.filter((record) => record.executed && !record.undone)
  const latestExecuted = executed[0]
  const statFreed = statistics.reportedFreedBytes ?? 0
  const historyFreed = executed.reduce((sum, record) => sum + cleanupFreedSize(record), 0)
  const statOperations = (statistics.cleanOperationCount ?? 0) + (statistics.agentCleanupOperationCount ?? 0) + (statistics.systemCacheCleanupCount ?? 0)
  const observedCacheReduction = Math.max(
    statistics.systemCacheObservedBytes ?? 0,
    executed.reduce((sum, record) => sum + Math.max(0, record.cleanupSummary?.systemCache?.observedDeltaBytes ?? 0), 0)
  )

  return {
    source: STOWMIND_SUPPLEMENT_ACTIVITY_SOURCE,
    totalFreed: Math.max(statFreed, historyFreed),
    executedCount: Math.max(statOperations, executed.length),
    previewCount: cleanup.filter((record) => record.cleanupSummary?.action === 'preview' || (!record.executed && !record.cleanupSummary?.outcome)).length,
    optimizedCount: executed.filter((record) => record.type === 'optimize').length,
    observedCacheReduction,
    latest: cleanup[0],
    latestExecuted,
    recent: cleanup.slice(0, 5),
  }
}

export function cleanupSize(record: HistoryRecord) {
  return record.cleanupSummary?.totalSize ?? 0
}

/** Legacy records lack proof that their size came from an execution report. */
export function cleanupFreedSize(record: HistoryRecord) {
  const size = record.cleanupSummary?.totalSize
  return record.executed && !record.undone && record.cleanupSummary?.sizeKind === 'reported_freed'
    && typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0
}

/** Tracked work is independent from physical disk space freed. */
export function cleanupProcessedSize(record: HistoryRecord) {
  if (!record.executed || record.undone) return 0
  const summary = record.cleanupSummary
  const value = summary?.processedSize ?? (summary?.sizeKind === 'processed' ? summary.totalSize : undefined)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function cleanupItems(record: HistoryRecord) {
  return record.cleanupSummary?.itemCount ?? record.totalFiles
}

function isCleanupType(type: HistoryRecordType) {
  return CLEANUP_TYPES.includes(type)
}
