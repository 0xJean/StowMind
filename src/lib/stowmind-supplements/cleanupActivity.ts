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
]

export interface CleanupActivitySummary {
  source: typeof STOWMIND_SUPPLEMENT_ACTIVITY_SOURCE
  totalFreed: number
  executedCount: number
  previewCount: number
  optimizedCount: number
  latest?: HistoryRecord
  latestExecuted?: HistoryRecord
  recent: HistoryRecord[]
}

export function buildCleanupActivitySummary(
  history: HistoryRecord[],
  statistics: Statistics
): CleanupActivitySummary {
  const cleanup = history.filter((record) => isCleanupType(record.type ?? 'organize'))
  const executed = cleanup.filter((record) => record.executed)
  const latestExecuted = executed[0]
  const statFreed = statistics.cleanSizeFreed ?? 0
  const historyFreed = executed.reduce((sum, record) => sum + cleanupSize(record), 0)

  return {
    source: STOWMIND_SUPPLEMENT_ACTIVITY_SOURCE,
    totalFreed: Math.max(statFreed, historyFreed),
    executedCount: statistics.cleanOperationCount ?? executed.length,
    previewCount: cleanup.length - executed.length,
    optimizedCount: cleanup.filter((record) => record.type === 'optimize').length,
    latest: cleanup[0],
    latestExecuted,
    recent: cleanup.slice(0, 5),
  }
}

export function cleanupSize(record: HistoryRecord) {
  return record.cleanupSummary?.totalSize ?? 0
}

export function cleanupItems(record: HistoryRecord) {
  return record.cleanupSummary?.itemCount ?? record.totalFiles
}

function isCleanupType(type: HistoryRecordType) {
  return CLEANUP_TYPES.includes(type)
}
