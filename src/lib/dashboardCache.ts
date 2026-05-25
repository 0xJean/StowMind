import { buildCleanupActivitySummary, type CleanupActivitySummary } from '@/lib/stowmind-supplements/cleanupActivity'
import type { HistoryRecord, Statistics } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'

export interface MoleStatusMetrics {
  health_score: number
  health_score_msg: string
  cpu: {
    usage: number
    core_count: number
  }
  memory: {
    used: number
    total: number
    used_percent: number
  }
  disks: Array<{
    mount: string
    used: number
    total: number
    used_percent: number
    external: boolean
  }>
  trash_size: number
}

export interface DashboardSnapshotPayload {
  moleStatus: MoleStatusMetrics | null
  history: HistoryRecord[]
  statistics: Statistics
  cleanupActivity: CleanupActivitySummary
}

interface DashboardCacheSnapshot {
  schemaVersion: number
  updatedAt: string
  payload: DashboardSnapshotPayload
}

const DASHBOARD_SCHEMA_VERSION = 1

export function hasDashboardSnapshotData(payload: DashboardSnapshotPayload) {
  const stats = payload.statistics
  return Boolean(
    payload.moleStatus ||
      payload.history.length > 0 ||
      stats.totalFilesOrganized > 0 ||
      stats.totalSizeOrganized > 0 ||
      Object.keys(stats.categoryCounts ?? {}).length > 0 ||
      (stats.cleanItemsRemoved ?? 0) > 0 ||
      (stats.cleanSizeFreed ?? 0) > 0 ||
      (stats.cleanOperationCount ?? 0) > 0 ||
      stats.lastOrganized ||
      stats.lastCleaned
  )
}

export function buildDashboardSnapshot(
  moleStatus: MoleStatusMetrics | null,
  history: HistoryRecord[],
  statistics: Statistics
): DashboardSnapshotPayload {
  return {
    moleStatus,
    history: history.slice(0, 20),
    statistics,
    cleanupActivity: buildCleanupActivitySummary(history, statistics),
  }
}

export async function loadDashboardSnapshot() {
  const snapshot = await invoke<DashboardCacheSnapshot | null>('dashboard_cache_load')
  if (!snapshot || snapshot.schemaVersion !== DASHBOARD_SCHEMA_VERSION) return null
  return snapshot.payload
}

export async function saveDashboardSnapshot(
  payload: DashboardSnapshotPayload,
  options: { preserveMoleStatusWhenNull?: boolean } = {}
) {
  let nextPayload = payload

  if (options.preserveMoleStatusWhenNull && !payload.moleStatus) {
    try {
      const existing = await loadDashboardSnapshot()
      if (existing?.moleStatus) {
        nextPayload = { ...payload, moleStatus: existing.moleStatus }
      }
    } catch {
      // Cache preservation is best-effort; the incoming snapshot is still valid.
    }
  }

  await invoke('dashboard_cache_save', {
    snapshot: {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      payload: nextPayload,
    },
  })
}
