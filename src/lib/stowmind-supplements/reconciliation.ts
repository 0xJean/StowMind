// StowMind supplement reconciliation.
//
// Mole remains the preferred execution engine. This module only fills the gap
// where Mole Console execution does not expose a structured JSON result yet.
// Values produced here must be labeled as StowMind supplement estimates or
// before/after comparisons, not as Mole-native execution reports.

export const STOWMIND_SUPPLEMENT_SOURCE = 'stowmind_supplement'

export type SupplementFlow = 'clean' | 'uninstall' | 'optimize'
export type SupplementConfidence = 'estimated' | 'verified_absent' | 'still_present' | 'status_comparison' | 'unknown'

interface StoredSupplementSnapshot<T> {
  source: typeof STOWMIND_SUPPLEMENT_SOURCE
  flow: SupplementFlow
  command: string
  createdAt: string
  snapshot: T
}

export interface CleanSupplementSnapshot {
  potential_space: number | null
  item_count: number | null
  summary_status?: 'exact' | 'at_least' | 'unavailable'
  scan_status?: 'complete' | 'incomplete' | 'unknown'
}

export interface CleanSupplementReconciliation {
  source: typeof STOWMIND_SUPPLEMENT_SOURCE
  confidence: SupplementConfidence
  beforePotentialBytes: number | null
  afterPotentialBytes: number | null
  estimatedFreedBytes: number | null
  beforeItemCount: number | null
  afterItemCount: number | null
  resolvedItemCount: number | null
}

export interface UninstallSupplementItemSnapshot {
  name: string
  uninstall_name: string
  path: string
  size_bytes: number
}

export interface UninstallSupplementReconciliation {
  source: typeof STOWMIND_SUPPLEMENT_SOURCE
  confidence: SupplementConfidence
  removed: boolean
  estimatedFreedBytes: number
}

export interface OptimizeSupplementSnapshot {
  health_score: number
  memory_used_gb: number
  disk_used_percent: number
  optimizations_count: number
}

export interface OptimizeSupplementReconciliation {
  source: typeof STOWMIND_SUPPLEMENT_SOURCE
  confidence: SupplementConfidence
  healthDelta: number
  memoryDeltaGb: number
  diskPercentDelta: number
  optimizationsDelta: number
}

const SNAPSHOT_KEY = 'stowmind.supplement.executionSnapshots.v1'

function readSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed as StoredSupplementSnapshot<unknown>[] : []
  } catch {
    return []
  }
}

function writeSnapshots(items: StoredSupplementSnapshot<unknown>[]) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(items.slice(-8)))
}

export function saveSupplementExecutionSnapshot<T>(flow: SupplementFlow, command: string, snapshot: T) {
  const next = readSnapshots().filter((item) => item.flow !== flow)
  next.push({
    source: STOWMIND_SUPPLEMENT_SOURCE,
    flow,
    command,
    createdAt: new Date().toISOString(),
    snapshot,
  })
  writeSnapshots(next)
}

export function loadSupplementExecutionSnapshot<T>(flow: SupplementFlow) {
  return readSnapshots().find((item) => item.flow === flow) as StoredSupplementSnapshot<T> | undefined
}

export function clearSupplementExecutionSnapshot(flow: SupplementFlow) {
  writeSnapshots(readSnapshots().filter((item) => item.flow !== flow))
}

export function reconcileCleanExecution(
  before: CleanSupplementSnapshot | null | undefined,
  after: CleanSupplementSnapshot | null | undefined
): CleanSupplementReconciliation | null {
  if (!before || !after) return null

  const beforePotentialBytes = cleanObservation(before.potential_space)
  const afterPotentialBytes = cleanObservation(after.potential_space)
  const beforeItemCount = cleanObservation(before.item_count)
  const afterItemCount = cleanObservation(after.item_count)
  // A difference between two lower bounds has no meaningful bound itself.
  // Legacy snapshots also lack evidence that either scan completed.
  const comparable = [before, after].every((snapshot) =>
    snapshot.scan_status === 'complete' && snapshot.summary_status === 'exact')
  const estimatedFreedBytes = comparable && beforePotentialBytes !== null && afterPotentialBytes !== null
    ? Math.max(0, beforePotentialBytes - afterPotentialBytes) : null
  const resolvedItemCount = comparable && beforeItemCount !== null && afterItemCount !== null
    ? Math.max(0, beforeItemCount - afterItemCount) : null
  return {
    source: STOWMIND_SUPPLEMENT_SOURCE,
    confidence: estimatedFreedBytes !== null ? 'estimated' : 'unknown',
    beforePotentialBytes,
    afterPotentialBytes,
    estimatedFreedBytes,
    beforeItemCount,
    afterItemCount,
    resolvedItemCount,
  }
}

function cleanObservation(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function reconcileUninstallExecution(
  before: UninstallSupplementItemSnapshot | null | undefined,
  afterItems: Array<{ name: string; uninstall_name: string; path: string }> | null | undefined
): UninstallSupplementReconciliation | null {
  if (!before || !afterItems) return null

  const stillPresent = afterItems.some((item) => {
    return item.path === before.path ||
      item.uninstall_name === before.uninstall_name ||
      item.name === before.name
  })

  return {
    source: STOWMIND_SUPPLEMENT_SOURCE,
    confidence: stillPresent ? 'still_present' : 'verified_absent',
    removed: !stillPresent,
    estimatedFreedBytes: stillPresent ? 0 : before.size_bytes,
  }
}

export function reconcileOptimizeExecution(
  before: OptimizeSupplementSnapshot | null | undefined,
  after: OptimizeSupplementSnapshot | null | undefined
): OptimizeSupplementReconciliation | null {
  if (!before || !after) return null

  return {
    source: STOWMIND_SUPPLEMENT_SOURCE,
    confidence: 'status_comparison',
    healthDelta: after.health_score - before.health_score,
    memoryDeltaGb: before.memory_used_gb - after.memory_used_gb,
    diskPercentDelta: before.disk_used_percent - after.disk_used_percent,
    optimizationsDelta: before.optimizations_count - after.optimizations_count,
  }
}
