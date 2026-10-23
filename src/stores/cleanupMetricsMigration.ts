/** Version 0 mixed file-size counters and previews into released-space totals. */
export const APP_STORE_VERSION = 1

type StoredObject = Record<string, unknown>

function object(value: unknown): value is StoredObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validBytes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function migrateRecord(value: unknown) {
  if (!object(value) || !object(value.cleanupSummary)) return value
  const summary = value.cleanupSummary
  if (summary.sizeKind === 'processed' && value.type === 'agent-cleanup' && summary.processedSizeKind == null) {
    return { ...value, cleanupSummary: { ...summary, processedSizeKind: 'unspecified' } }
  }
  if (summary.sizeKind !== 'reported_freed') return value
  // Both Mole engines report pre-deletion file sizes, including permanent
  // removal. Preserve the recorded amount without claiming a disk-space delta.
  const sizeKind = value.type === 'installer' || value.type === 'uninstall' ? 'processed'
    : verifiedRecord(value) ? 'reported_freed' : 'unknown'
  return sizeKind === 'reported_freed' ? value : {
    ...value,
    cleanupSummary: {
      ...summary, sizeKind,
      ...(sizeKind === 'processed' && summary.processedSizeKind == null ? { processedSizeKind: 'unspecified' } : {}),
    },
  }
}

function verifiedRecord(record: StoredObject) {
  if ((record.type !== 'clean' && record.type !== 'purge')
    || record.executed !== true || record.undone || !object(record.cleanupSummary)) return false
  const summary = record.cleanupSummary
  return summary.action === 'execute' && summary.sizeKind === 'reported_freed'
    && (summary.outcome === 'success' || summary.outcome === 'partial') && validBytes(summary.totalSize)
}

function verifiedFreedBytes(history: unknown[]) {
  let total = 0
  for (const record of history) {
    if (!object(record) || !verifiedRecord(record)) continue
    total += (record.cleanupSummary as StoredObject).totalSize as number
    // An overflowing aggregate is not a trustworthy released-space total.
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}

/** Pure persisted-state migration; never accesses storage or user files. */
export function migrateCleanupMetrics(persistedState: unknown, fromVersion: number): unknown {
  if (fromVersion >= APP_STORE_VERSION) return persistedState
  if (!object(persistedState)) return {}
  let history = Array.isArray(persistedState.history) ? persistedState.history.map(migrateRecord) : []
  const previous = object(persistedState.statistics) ? persistedState.statistics : {}
  const verified = verifiedFreedBytes(history)
  // Prevent history-based HUD aggregation from resurrecting an unsafe sum.
  if (verified === null) history = history.map((record) => object(record) && object(record.cleanupSummary)
    && record.cleanupSummary.sizeKind === 'reported_freed'
    ? { ...record, cleanupSummary: { ...record.cleanupSummary, sizeKind: 'unknown' } } : record)
  const legacy = [previous.reportedFreedBytes, previous.cleanSizeFreed, previous.legacyUnverifiedFreedBytes]
    .filter(validBytes)
  return {
    ...persistedState,
    ...(Array.isArray(persistedState.history) ? { history } : {}),
    statistics: {
      // Zustand merges top-level keys. Retain the statistics defaults when a
      // legacy partial store never persisted that object.
      totalFilesOrganized: 0, totalSizeOrganized: 0, categoryCounts: {},
      ...previous,
      cleanSizeFreed: verified ?? 0,
      reportedFreedBytes: verified ?? 0,
      ...(legacy.length ? { legacyUnverifiedFreedBytes: Math.max(...legacy) } : {}),
    },
  }
}
