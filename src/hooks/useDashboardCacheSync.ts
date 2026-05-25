import { useAppStore } from '@/stores/app'
import { useEffect, useMemo } from 'react'
import {
  buildDashboardSnapshot,
  hasDashboardSnapshotData,
  saveDashboardSnapshot,
  type MoleStatusMetrics,
} from '@/lib/dashboardCache'

export function useDashboardCacheSync(moleStatus: MoleStatusMetrics | null = null) {
  const statistics = useAppStore((s) => s.statistics)
  const history = useAppStore((s) => s.history)
  const snapshot = useMemo(
    () => buildDashboardSnapshot(moleStatus, history, statistics),
    [moleStatus, history, statistics]
  )

  useEffect(() => {
    if (!hasDashboardSnapshotData(snapshot)) return
    void saveDashboardSnapshot(snapshot, { preserveMoleStatusWhenNull: true }).catch(() => {})
  }, [snapshot])
}
