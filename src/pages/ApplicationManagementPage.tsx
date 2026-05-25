import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import {
  runStowmindSupplementAppUpdateAction,
  scanStowmindSupplementAppUpdates,
  type StowmindSupplementAppUpdateScan,
} from '@/lib/stowmind-supplements/appUpdates'
import { cn, formatFileSize } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { open as openPath } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import { Activity, AppWindow, Download, HardDrive, Loader2, Search, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import { ApplicationList } from './application-management/ApplicationList'
import { buildManagedRows, filterManagedRows } from './application-management/appMatching'
import type { MoleAppUpdateCapability } from './application-management/updateTypes'
import type {
  AppManagementTab,
  ManagedAppRow,
  MoleUninstallList,
  MoleUninstallOperationOutput,
  SortMode,
} from './application-management/types'

interface ApplicationManagementSnapshot {
  data: MoleUninstallList | null
  appCapability: MoleAppUpdateCapability | null
  updateScan: StowmindSupplementAppUpdateScan | null
}

function stripIconPayloads(list: MoleUninstallList | null | undefined): MoleUninstallList | null {
  if (!list) return null
  if (!list.items.some((item) => item.icon_data_url)) return list
  return {
    ...list,
    items: list.items.map((item) => ({ ...item, icon_data_url: undefined })),
  }
}

export function ApplicationManagementPage() {
  const { t } = useI18n()
  const [data, setData] = useState<MoleUninstallList | null>(null)
  const [appCapability, setAppCapability] = useState<MoleAppUpdateCapability | null>(null)
  const [updateScan, setUpdateScan] = useState<StowmindSupplementAppUpdateScan | null>(null)
  const [selected, setSelected] = useState<ManagedAppRow | null>(null)
  const [preview, setPreview] = useState<MoleUninstallOperationOutput | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [updatingPath, setUpdatingPath] = useState<string | null>(null)
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [tab, setTab] = useState<AppManagementTab>('all')
  const [sortMode, setSortMode] = useState<SortMode>('size_desc')
  const addHistory = useAppStore((s) => s.addHistory)
  const statistics = useAppStore((s) => s.statistics)
  const updateStatistics = useAppStore((s) => s.updateStatistics)

  const refresh = async () => {
    setLoading(true)
    try {
      const [listResult, capabilityResult] = await Promise.allSettled([
        invoke<MoleUninstallList>('mole_uninstall_list_json'),
        invoke<MoleAppUpdateCapability>('mole_app_update_capability_json'),
      ])
      if (capabilityResult.status === 'fulfilled') setAppCapability(capabilityResult.value)
      if (listResult.status === 'rejected') throw listResult.reason
      const list = stripIconPayloads(listResult.value)
      setData(list)
      await saveAppManagementSnapshotPatch({
        data: list,
        appCapability: capabilityResult.status === 'fulfilled' ? capabilityResult.value : appCapability,
      })
      return list
    } catch (err) {
      toast.error(t('apps.fail', { error: String(err) }))
      return null
    } finally {
      setLoading(false)
    }
  }

  const scanUpdates = async () => {
    setUpdateLoading(true)
    try {
      const scan = await scanStowmindSupplementAppUpdates()
      setUpdateScan(scan)
      await saveAppManagementSnapshotPatch({ updateScan: scan })
      toast.success(t('apps.updateScanDone', { count: String(scan.scannedApps) }))
    } catch (err) {
      toast.error(t('apps.updateScanFail', { error: String(err) }))
    } finally {
      setUpdateLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snapshot = await loadResultSnapshot<ApplicationManagementSnapshot>(resultCacheKeys.appManagement)
      if (cancelled) return
      if (snapshot) {
        setData(stripIconPayloads(snapshot.payload.data))
        setAppCapability(snapshot.payload.appCapability)
        setUpdateScan(snapshot.payload.updateScan)
      }
      await refresh()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveAppManagementSnapshotPatch = async (patch: Partial<ApplicationManagementSnapshot>) => {
    const current = await loadResultSnapshot<ApplicationManagementSnapshot>(resultCacheKeys.appManagement)
    await saveResultSnapshot(resultCacheKeys.appManagement, {
      data: patch.data ?? current?.payload.data ?? data,
      appCapability: patch.appCapability ?? current?.payload.appCapability ?? appCapability,
      updateScan: patch.updateScan ?? current?.payload.updateScan ?? updateScan,
    })
  }

  const rows = useMemo(
    () => buildManagedRows(data?.items ?? [], updateScan?.items ?? []),
    [data, updateScan]
  )
  const filteredRows = useMemo(
    () => filterManagedRows(rows, query, source, tab, sortMode),
    [rows, query, source, tab, sortMode]
  )
  const sourceStats = useMemo(() => {
    const sources = Array.from(new Set((data?.items ?? []).map((item) => item.source).filter(Boolean))).sort()
    return sources.map((value) => ({
      value,
      label: value,
      count: (data?.items ?? []).filter((item) => item.source === value).length,
    }))
  }, [data])
  const sourceScopedRows = useMemo(
    () => (source === 'all' ? rows : rows.filter((row) => row.uninstall.source === source)),
    [rows, source]
  )
  const totalForTab = sourceScopedRows.length
  const updateCandidates = sourceScopedRows.filter((row) => row.update?.updateStatus === 'available').length
  const allUpdateCandidates = rows.filter((row) => row.update?.updateStatus === 'available').length
  const autoUpdateRows = rows.filter((row) => row.update?.updateStatus === 'available' && row.update.actionKind === 'brew_cask_upgrade' && row.update.actionTarget)
  const homebrewCount = rows.filter((row) => row.uninstall.source.toLowerCase().includes('homebrew')).length

  const selectRow = (row: ManagedAppRow) => {
    setSelected(row)
    setPreview(null)
    setConfirming(false)
  }

  const reveal = (path: string) => {
    void openPath(path).catch(() => toast.error(t('apps.openFail')))
  }

  const previewUninstall = async () => {
    if (!selected) return
    setPreviewing(true)
    try {
      const result = await invoke<MoleUninstallOperationOutput>('mole_uninstall_preview', {
        uninstallName: selected.uninstall.uninstall_name,
        path: selected.uninstall.path,
      })
      setPreview(result)
      toast.success(t('apps.previewDone', { count: String(result.item_count || 1) }))
    } catch (err) {
      toast.error(t('apps.previewFail', { error: String(err) }))
    } finally {
      setPreviewing(false)
    }
  }

  const executeUninstall = async () => {
    if (!selected) return
    setExecuting(true)
    try {
      const result = await invoke<MoleUninstallOperationOutput>('mole_uninstall_execute', {
        uninstallName: selected.uninstall.uninstall_name,
        path: selected.uninstall.path,
      })
      recordExecution(result)
      toast.success(t('apps.uninstallSuccess', { name: selected.uninstall.name }))
      setPreview(null)
      setSelected(null)
      setConfirming(false)
      await refresh()
    } catch (err) {
      toast.error(t('apps.uninstallFail', { error: String(err) }))
    } finally {
      setExecuting(false)
    }
  }

  const runUpdateAction = async (row: ManagedAppRow) => {
    const actionKind = row.update?.actionKind
    const actionTarget = row.update?.actionTarget
    if (!actionKind || !actionTarget) return
    setUpdatingPath(row.uninstall.path)
    try {
      await runStowmindSupplementAppUpdateAction(actionKind, actionTarget)
      toast.success(t('apps.updateActionDone', { name: row.uninstall.name }))
      await scanUpdates()
    } catch (err) {
      toast.error(t('apps.updateActionFail', { error: String(err) }))
    } finally {
      setUpdatingPath(null)
    }
  }

  const runBulkAutoUpdates = async () => {
    if (autoUpdateRows.length === 0) return
    setBulkUpdating(true)
    try {
      for (const row of autoUpdateRows) {
        if (!row.update?.actionKind || !row.update.actionTarget) continue
        setUpdatingPath(row.uninstall.path)
        await runStowmindSupplementAppUpdateAction(row.update.actionKind, row.update.actionTarget)
      }
      toast.success(t('apps.bulkUpdateDone', { count: String(autoUpdateRows.length) }))
      await scanUpdates()
    } catch (err) {
      toast.error(t('apps.updateActionFail', { error: String(err) }))
    } finally {
      setUpdatingPath(null)
      setBulkUpdating(false)
    }
  }

  const recordExecution = (result: MoleUninstallOperationOutput) => {
    if (!selected) return
    const itemCount = result.item_count || 1
    const totalSize = result.total_size || selected.uninstall.size_bytes
    const timestamp = new Date().toISOString()
    addHistory(createCleanupHistoryRecord({
      type: 'uninstall',
      target: selected.uninstall.name,
      label: t('history.type.uninstall'),
      itemCount,
      totalSize,
      action: 'execute',
      executed: true,
      timestamp,
    }))
    updateStatistics({
      cleanItemsRemoved: (statistics.cleanItemsRemoved ?? 0) + itemCount,
      cleanSizeFreed: (statistics.cleanSizeFreed ?? 0) + totalSize,
      cleanOperationCount: (statistics.cleanOperationCount ?? 0) + 1,
      lastCleaned: timestamp,
    })
  }

  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div className="min-w-0">
          <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('apps.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('apps.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="iqon-pill">
            <span className="iqon-dot iqon-dot-green" />
            {appCapability?.cliExposed ? t('apps.updateNative') : t('apps.badge.moleGui')}
          </span>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
            {t('apps.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void scanUpdates()} disabled={updateLoading}>
            {updateLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {t('apps.scanUpdates')}
          </Button>
          {autoUpdateRows.length > 0 && (
            <Button size="sm" onClick={() => void runBulkAutoUpdates()} disabled={bulkUpdating || Boolean(updatingPath)}>
              {bulkUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {t('apps.bulkUpdateHomebrew', { count: String(autoUpdateRows.length) })}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={AppWindow} label={t('apps.metric.totalApps')} value={String(data?.items.length ?? 0)} />
        <MetricCard icon={HardDrive} label={t('apps.metric.totalSize')} value={formatFileSize(data?.total_size ?? 0)} />
        <MetricCard icon={Download} label={t('apps.metric.updates')} value={String(allUpdateCandidates)} tone={allUpdateCandidates > 0 ? 'warning' : 'default'} />
        <MetricCard icon={Sparkles} label={t('apps.metric.homebrew')} value={String(homebrewCount)} />
      </div>

      <div className="stow-panel p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div className="inline-flex rounded-2xl border border-border/70 bg-surface-hover p-1">
              <ModeButton active={tab === 'all'} label={t('apps.mode.all')} count={totalForTab} onClick={() => setTab('all')} />
              <ModeButton active={tab === 'updates'} label={t('apps.mode.update')} count={updateCandidates} onClick={() => setTab('updates')} />
            </div>
            {sourceStats.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-l border-border/70 pl-4">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t('apps.sourceLabel')}
                </span>
                <button
                  type="button"
                  className={cn(
                    'rounded-xl border px-3 py-2 text-xs font-bold transition-colors',
                    source === 'all'
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border/70 bg-card text-muted-foreground hover:bg-surface-hover hover:text-foreground'
                  )}
                  onClick={() => setSource('all')}
                >
                  {t('apps.mode.all')}
                </button>
                {sourceStats.map((stat) => (
                  <button
                    key={stat.value}
                    type="button"
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs font-bold transition-colors',
                      source === stat.value
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border/70 bg-card text-muted-foreground hover:bg-surface-hover hover:text-foreground'
                    )}
                    onClick={() => setSource(stat.value)}
                  >
                    {stat.label}
                    <span className="ml-2 font-mono text-[11px] opacity-70">{stat.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              <SortButton active={sortMode === 'name'} label={t('apps.sortName')} onClick={() => setSortMode('name')} />
              <SortButton active={sortMode === 'size_desc'} label={t('apps.sortSizeDescShort')} onClick={() => setSortMode('size_desc')} />
              <SortButton active={sortMode === 'update'} label={t('apps.sortUpdate')} onClick={() => setSortMode('update')} />
              {(loading || updateLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="relative min-w-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('apps.searchPlaceholderShort')}
                className="h-10 pl-9"
              />
            </div>
            {selected && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => reveal(selected.uninstall.path)}>
                  {t('apps.openPath')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void previewUninstall()} disabled={previewing || executing}>
                  {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
                  {t('apps.previewUninstall')}
                </Button>
                <Button variant={confirming ? 'secondary' : 'destructive'} size="sm" onClick={() => setConfirming(true)} disabled={previewing || executing}>
                  {executing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  {t('apps.uninstallWithMole')}
                </Button>
              </div>
            )}
          </div>
        </div>

        {confirming && selected && (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-bold text-destructive">{t('apps.confirmTitle')}</p>
            <p className="mt-1 text-muted-foreground">{t('apps.confirmDesc', { name: selected.uninstall.name })}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="destructive" size="sm" onClick={() => void executeUninstall()} disabled={executing}>
                {executing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('apps.confirmRun')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={executing}>
                {t('apps.confirmCancel')}
              </Button>
            </div>
          </div>
        )}

        {preview && (
          <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm">
            <p className="font-bold text-primary">{t('apps.previewReadyTitle')}</p>
            <p className="mt-1 text-muted-foreground">
              {t('apps.previewReadyDesc', {
                count: String(preview.item_count || 1),
                size: formatFileSize(preview.total_size || selected?.uninstall.size_bytes || 0),
              })}
            </p>
          </div>
        )}
      </div>

      <div>
        <ApplicationList
          rows={filteredRows}
          selectedPath={selected?.uninstall.path}
          onSelect={selectRow}
          onReveal={reveal}
          onUpdateAction={(row) => void runUpdateAction(row)}
          updatingPath={updatingPath}
        />
      </div>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof AppWindow
  label: string
  value: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div
      className={cn(
        'stow-panel flex items-center justify-between gap-4 p-5',
        tone === 'warning' && 'border-yellow-400/25 bg-yellow-500/10'
      )}
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-normal text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold tracking-normal">{value}</p>
      </div>
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary', tone === 'warning' && 'bg-yellow-500/15 text-yellow-600')}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  )
}

function ModeButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl px-4 py-2 text-sm font-bold transition-colors',
        active ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'
      )}
    >
      {label}
      <span className="ml-2 font-mono text-xs text-muted-foreground">{count}</span>
    </button>
  )
}

function SortButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
