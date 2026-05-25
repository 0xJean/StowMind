import { useDashboardCacheSync } from '@/hooks/useDashboardCacheSync'
import { useI18n } from '@/i18n'
import {
  buildDashboardSnapshot,
  hasDashboardSnapshotData,
  loadDashboardSnapshot,
  type DashboardSnapshotPayload,
  type MoleStatusMetrics,
} from '@/lib/dashboardCache'
import { loadResultSnapshot, resultCacheKeys } from '@/lib/resultCache'
import { formatFileSize } from '@/lib/utils'
import type { MoleDoctorResult } from '@/pages/mole/doctorTypes'
import { useAppStore, type HistoryRecord, type HistoryRecordType } from '@/stores/app'
import { useMoleStore } from '@/stores/mole'
import { invoke } from '@tauri-apps/api/tauri'
import {
  Archive,
  BarChart3,
  Copy,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  MemoryStick,
  PackageSearch,
  PackageX,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { openHudPopover } from '@/pages/hud/native'
import { ActionCard, GroupSection, MetricCard, RecentActivityCard, type ToneKey } from './homeCards'

interface TypeStat {
  count: number
  freed: number
  items: number
}

function pct(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  return `${Math.round(value)}%`
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function aggregateByType(history: HistoryRecord[]): Map<HistoryRecordType, TypeStat> {
  const map = new Map<HistoryRecordType, TypeStat>()
  for (const r of history) {
    if (!r.executed || r.undone) continue
    const type = r.type ?? 'organize'
    const cur = map.get(type) ?? { count: 0, freed: 0, items: 0 }
    cur.count += 1
    cur.freed += r.cleanupSummary?.totalSize ?? 0
    cur.items += type === 'organize' ? r.totalFiles : r.cleanupSummary?.itemCount ?? r.totalFiles
    map.set(type, cur)
  }
  return map
}

export function HomePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const statistics = useAppStore((s) => s.statistics)
  const history = useAppStore((s) => s.history)
  const moleUpdate = useMoleStore((s) => s.update)
  const [moleStatus, setMoleStatus] = useState<MoleStatusMetrics | null>(null)
  const [moleStatusError, setMoleStatusError] = useState<string | null>(null)
  const [cachedSnapshot, setCachedSnapshot] = useState<DashboardSnapshotPayload | null>(null)
  const [doctorSnapshot, setDoctorSnapshot] = useState<MoleDoctorResult | null>(null)

  const liveSnapshot = useMemo(
    () => buildDashboardSnapshot(moleStatus, history, statistics),
    [moleStatus, history, statistics]
  )
  const hasLiveSnapshotData = hasDashboardSnapshotData(liveSnapshot)
  const dashboardStatus = moleStatus ?? cachedSnapshot?.moleStatus ?? null
  const dashboardHistory = history.length > 0 ? history : cachedSnapshot?.history ?? []
  const dashboardStatistics = hasLiveSnapshotData ? statistics : cachedSnapshot?.statistics ?? statistics
  const dashboardSnapshot = buildDashboardSnapshot(dashboardStatus, dashboardHistory, dashboardStatistics)
  const cleanupActivity = dashboardSnapshot.cleanupActivity
  const showingCachedStatus = !moleStatus && Boolean(cachedSnapshot?.moleStatus)
  useDashboardCacheSync(dashboardStatus)

  const byType = useMemo(() => aggregateByType(dashboardHistory), [dashboardHistory])
  const totalRuns = Array.from(byType.values()).reduce((s, v) => s + v.count, 0)

  useEffect(() => {
    let cancelled = false
    void loadDashboardSnapshot()
      .then((snapshot) => { if (!cancelled) setCachedSnapshot(snapshot) })
      .catch(() => { if (!cancelled) setCachedSnapshot(null) })
    void loadResultSnapshot<MoleDoctorResult>(resultCacheKeys.doctor)
      .then((snap) => { if (!cancelled && snap) setDoctorSnapshot(snap.payload) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    invoke<MoleStatusMetrics>('mole_status_json')
      .then((status) => {
        if (!cancelled) { setMoleStatus(status); setMoleStatusError(null) }
      })
      .catch((err) => {
        if (!cancelled) { setMoleStatus(null); setMoleStatusError(String(err)) }
      })
    return () => { cancelled = true }
  }, [])

  const primaryDisk = dashboardStatus?.disks.find((d) => d.mount === '/') ?? dashboardStatus?.disks[0]
  const cpuPercent = clamp(dashboardStatus?.cpu.usage ?? 0)
  const memoryPercent = clamp(dashboardStatus?.memory.used_percent ?? 0)
  const diskPercent = clamp(primaryDisk?.used_percent ?? 0)

  const cpuTone: ToneKey = cpuPercent >= 80 ? 'red' : cpuPercent >= 60 ? 'yellow' : 'cyan'
  const memTone: ToneKey = memoryPercent >= 80 ? 'red' : memoryPercent >= 60 ? 'yellow' : 'green'
  const diskTone: ToneKey = diskPercent >= 80 ? 'red' : diskPercent >= 60 ? 'yellow' : 'green'

  const totalFreed = formatFileSize(cleanupActivity.totalFreed)

  const stat = (type: HistoryRecordType) => byType.get(type)
  const formatRuns = (s: TypeStat | undefined) =>
    s && s.count > 0 ? t('home.stat.runs', { n: s.count }) : t('home.stat.never')
  const formatRunsAndFreed = (s: TypeStat | undefined) => {
    if (!s || s.count === 0) return t('home.stat.never')
    if (s.freed > 0) return `${t('home.stat.runs', { n: s.count })} · ${t('home.stat.freed', { size: formatFileSize(s.freed) })}`
    return t('home.stat.runs', { n: s.count })
  }

  const cleanStat = stat('clean')
  const installerStat = stat('installer')
  const purgeStat = stat('purge')
  const organizeStat = stat('organize')
  const appsStat = stat('uninstall')
  const optimizeStat = stat('optimize')

  const doctorIssueCount = doctorSnapshot
    ? doctorSnapshot.checks.filter((c) => c.level !== 'success').length
    : null
  const doctorTone: ToneKey =
    doctorIssueCount === null ? 'cyan' : doctorIssueCount === 0 ? 'green' : doctorIssueCount > 3 ? 'red' : 'yellow'
  const doctorStatus =
    doctorIssueCount === null
      ? t('home.stat.notChecked')
      : doctorIssueCount === 0
        ? t('home.stat.allClear')
        : t('home.stat.issues', { n: doctorIssueCount })

  const updateTone: ToneKey = moleUpdate.checking
    ? 'cyan'
    : !moleUpdate.checked
      ? 'cyan'
      : moleUpdate.available
        ? 'yellow'
        : 'green'
  const updateStatus = moleUpdate.checking
    ? t('home.stat.updateChecking')
    : !moleUpdate.checked
      ? t('home.stat.notChecked')
      : moleUpdate.available
        ? t('home.stat.updateAvailable')
        : t('home.stat.updateClear')

  return (
    <div className="mx-auto w-full max-w-[1600px] p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="iqon-eyebrow mb-1">{t('home.eyebrow')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('home.welcome')}</h1>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-iqon-border bg-iqon-card px-4 py-2">
          <span className="iqon-dot iqon-dot-green animate-pulse" />
          <span className="text-xs font-bold">
            {dashboardStatus ? t(showingCachedStatus ? 'home.cachedStatus' : 'home.realtime') : t('home.moleStatusLoading')}
          </span>
        </div>
      </div>

      {moleStatusError && (
        <div className="mb-4 rounded-2xl border border-iqon-red/30 bg-iqon-red/10 p-4 text-sm">
          <p className="font-bold text-iqon-red">{t('home.moleStatusUnavailable')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{moleStatusError}</p>
        </div>
      )}

      {/* Status hero region */}
      <div className="mb-6 grid auto-rows-[minmax(140px,auto)] grid-cols-12 gap-4">
        <button
          type="button"
          className="iqon-card iqon-card-hover group relative col-span-12 flex flex-col justify-between overflow-hidden p-4 text-left md:col-span-6 xl:col-span-3"
          onClick={() => navigate('/status')}
        >
          <div className="pointer-events-none absolute inset-0 z-0">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-iqon-green opacity-[0.22] blur-[50px]" />
            <div className="iqon-mesh-soft absolute inset-0 text-iqon-green/45" />
          </div>
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="iqon-eyebrow">{t('home.healthScore')}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {dashboardStatus ? dashboardStatus.health_score : '—'}
              </p>
              <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                {dashboardStatus?.health_score_msg ?? t('home.moleStatusLoading')}
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-iqon-border bg-iqon-row">
              <ShieldCheck className="h-5 w-5 text-iqon-green" />
            </span>
          </div>
          <div className="relative z-10 mt-3">
            <div className="mb-1.5 flex justify-between text-[10px] text-muted-foreground">
              <span>{t('home.healthScore')}</span>
              <span className="font-mono">
                {dashboardStatus ? `${dashboardStatus.health_score}/100` : '—'}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-iqon-border">
              <div
                className="h-full rounded-full bg-iqon-green"
                style={{ width: `${clamp(dashboardStatus?.health_score ?? 0)}%` }}
              />
            </div>
          </div>
        </button>

        <MetricCard
          tone={cpuTone}
          title={t('home.cpuLabel')}
          subtitle={dashboardStatus ? `${dashboardStatus.cpu.core_count} cores` : '—'}
          status={cpuPercent >= 80 ? 'High Load' : 'Optimal'}
          icon={Cpu}
          value={`${pct(dashboardStatus?.cpu.usage)}`}
          progressLabel={t('home.cpuLabel')}
          progressValue={cpuPercent}
          colSpan={3}
          onClick={() => navigate('/status')}
        />
        <MetricCard
          tone={memTone}
          title={t('home.memoryLabel')}
          subtitle={dashboardStatus ? `${formatFileSize(dashboardStatus.memory.total)} · ${formatFileSize(dashboardStatus.memory.used)} used` : '—'}
          status={memoryPercent >= 80 ? 'Heavy Load' : 'Optimal'}
          icon={MemoryStick}
          value={`${pct(dashboardStatus?.memory.used_percent)}`}
          progressLabel={t('home.memoryLabel')}
          progressValue={memoryPercent}
          colSpan={3}
          onClick={() => navigate('/status')}
        />
        <MetricCard
          tone={diskTone}
          title={t('home.diskUsage')}
          subtitle={primaryDisk?.mount ?? '—'}
          status={diskPercent >= 80 ? 'Low Space' : 'Optimal'}
          icon={HardDrive}
          value={pct(primaryDisk?.used_percent)}
          progressLabel={t('home.diskUsage')}
          progressValue={diskPercent}
          colSpan={3}
          onClick={() => navigate('/analyze')}
        />
      </div>

      {/* Group: 清理 */}
      <GroupSection label={t('home.group.cleaning')}>
        <ActionCard
          tone="red"
          icon={Trash2}
          title={t('home.cleanSystemTitle')}
          subtitle={t('home.cleanSystemDesc')}
          status={formatRunsAndFreed(cleanStat)}
          cta={t('home.action.clean')}
          onClick={() => navigate('/clean')}
          pulse={!cleanStat || cleanStat.count === 0}
          colSpan={3}
        />
        <ActionCard
          tone="cyan"
          icon={Archive}
          title={t('home.cleanInstallerTitle')}
          subtitle={t('home.cleanInstallerDesc')}
          status={formatRunsAndFreed(installerStat)}
          cta={t('home.action.installers')}
          onClick={() => navigate('/installers')}
          colSpan={3}
        />
        <ActionCard
          tone="yellow"
          icon={PackageX}
          title={t('home.cleanPurgeTitle')}
          subtitle={t('home.cleanPurgeDesc')}
          status={formatRunsAndFreed(purgeStat)}
          cta={t('home.action.purge')}
          onClick={() => navigate('/purge')}
          colSpan={3}
        />
        <ActionCard
          tone="purple"
          icon={Copy}
          title={t('home.cleanDuplicatesTitle')}
          subtitle={t('home.cleanDuplicatesDesc')}
          status={t('home.stat.never')}
          cta={t('home.action.duplicates')}
          onClick={() => navigate('/duplicates')}
          colSpan={3}
        />
      </GroupSection>

      {/* Group: 文件 */}
      <GroupSection label={t('home.group.files')}>
        <ActionCard
          tone="green"
          icon={Sparkles}
          title={t('home.cleanOrganizeTitle')}
          subtitle={t('home.cleanOrganizeDesc')}
          status={
            organizeStat && organizeStat.count > 0
              ? `${t('home.stat.runs', { n: organizeStat.count })} · ${t('home.stat.files', { n: organizeStat.items })}`
              : t('home.stat.never')
          }
          cta={t('home.action.organize')}
          onClick={() => navigate('/organize')}
        />
        <ActionCard
          tone="cyan"
          icon={HardDrive}
          title={t('home.cleanAnalyzeTitle')}
          subtitle={t('home.cleanAnalyzeDesc')}
          status={primaryDisk
            ? t('home.diskDetail', { used: formatFileSize(primaryDisk.used), total: formatFileSize(primaryDisk.total) })
            : t('home.moleStatusLoading')}
          cta={t('home.action.analyze')}
          onClick={() => navigate('/analyze')}
        />
      </GroupSection>

      {/* Group: 应用与系统 */}
      <GroupSection label={t('home.group.system')}>
        <ActionCard
          tone="yellow"
          icon={PackageSearch}
          title={t('home.cleanUninstallTitle')}
          subtitle={t('home.cleanUninstallDesc')}
          status={formatRunsAndFreed(appsStat)}
          cta={t('home.action.apps')}
          onClick={() => navigate('/apps')}
          colSpan={3}
        />
        <ActionCard
          tone="green"
          icon={Zap}
          title={t('home.cleanOptimizeTitle')}
          subtitle={t('home.cleanOptimizeDesc')}
          status={formatRuns(optimizeStat)}
          cta={t('home.action.optimize')}
          onClick={() => navigate('/optimize')}
          colSpan={3}
        />
        <ActionCard
          tone={doctorTone}
          icon={ShieldCheck}
          title={t('home.cardDoctorTitle')}
          subtitle={t('home.cardDoctorDesc')}
          status={doctorStatus}
          cta={t('home.action.doctor')}
          onClick={() => navigate('/doctor')}
          colSpan={3}
        />
        <ActionCard
          tone={updateTone}
          icon={Download}
          title={t('home.cardSoftwareUpdateTitle')}
          subtitle={t('home.cardSoftwareUpdateDesc')}
          status={updateStatus}
          cta={t('home.action.softwareUpdate')}
          onClick={() => navigate('/software-update')}
          pulse={moleUpdate.available}
          colSpan={3}
        />
      </GroupSection>

      {/* Group: 工具与记录 */}
      <GroupSection label={t('home.group.tools')}>
        <ActionCard
          tone="cyan"
          icon={Gauge}
          title={t('home.cardHudTitle')}
          subtitle={t('home.cardHudDesc')}
          status={t('home.action.hud')}
          cta={t('home.action.openHud')}
          onClick={() => void openHudPopover()}
        />
        <ActionCard
          tone="purple"
          icon={BarChart3}
          title={t('home.cardStatsTitle')}
          subtitle={t('home.cardStatsDesc')}
          status={
            totalRuns > 0
              ? `${t('home.stat.runs', { n: totalRuns })} · ${t('home.stat.freed', { size: totalFreed })}`
              : t('home.stat.never')
          }
          cta={t('home.action.stats')}
          onClick={() => navigate('/statistics')}
        />
        <RecentActivityCard history={dashboardHistory} onSeeAll={() => navigate('/history')} />
      </GroupSection>
    </div>
  )
}
