import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { movePathToTrashWithStowMindSupplement } from '@/lib/stowmind-supplements/trash'
import { formatFileSize } from '@/lib/utils'
import { open } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { open as openPath } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { toast } from 'react-toastify'
import { AnalyzeContextMenu, type AnalyzeContextMenuState, AnalyzeRow } from './analyze/AnalyzeWidgets'
import { AnalyzeSystemView } from './analyze/AnalyzeSystemView'
import { createAnalyzeCacheWriter, formatCacheAge, getCachedAnalyze } from './analyze/analyzeCache'
import { buildTreemap } from './analyze/treemap'
import { waitForPaint } from './analyze/uiScheduler'
import { compactAnalyzeResult, type MoleAnalyzeEntry, type MoleAnalyzePartial, type MoleAnalyzeProgress, type MoleAnalyzeResult } from './analyze/types'

const SYSTEM_ANALYZE_PATH = '/'

function parentPath(path: string) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash > 0 ? path.slice(0, slash) : path
}

function isPermissionError(message: string | null) {
  if (!message) return false
  const lower = message.toLowerCase()
  return (
    lower.includes('permission denied') ||
    lower.includes('operation not permitted') ||
    lower.includes('full disk access') ||
    lower.includes('eperm') ||
    lower.includes('access is denied')
  )
}

export function AnalyzePage() {
  const { t } = useI18n()
  const [directory, setDirectory] = useState(SYSTEM_ANALYZE_PATH)
  const [result, setResult] = useState<MoleAnalyzeResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [pathStack, setPathStack] = useState<string[]>([])
  const [cacheInfo, setCacheInfo] = useState<string | null>(null)
  const [cacheLoading] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<AnalyzeContextMenuState | null>(null)
  const [progress, setProgress] = useState<MoleAnalyzeProgress | null>(null)
  const [progressLog, setProgressLog] = useState<MoleAnalyzeProgress[]>([])
  const activeRunIdRef = useRef<string | null>(null)
  const activeAnalyzePathRef = useRef<string | null>(null)
  const tRef = useRef(t)
  const cacheWriter = useMemo(() => createAnalyzeCacheWriter(), [])

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => () => {
    cacheWriter.dispose()
  }, [cacheWriter])

  useEffect(() => {
    let disposed = false
    let unlistenProgress: (() => void) | null = null
    let unlistenPartial: (() => void) | null = null

    listen<MoleAnalyzeProgress>('mole-analyze-progress', (event) => {
      if (disposed || event.payload.runId !== activeRunIdRef.current) return
      setProgress(event.payload)
      setProgressLog((log) => [...log, event.payload].slice(-8))
    }).then((fn) => {
      if (disposed) fn()
      else unlistenProgress = fn
    }).catch(() => {})

    listen<MoleAnalyzePartial>('mole-analyze-partial', (event) => {
      if (disposed || event.payload.runId !== activeRunIdRef.current) return
      const path = activeAnalyzePathRef.current ?? event.payload.result.path
      setResult(compactAnalyzeResult(event.payload.result))
      setFocusedPath(null)
      setPathStack([])
      setScanError(null)
      setCacheInfo(tRef.current('analyze.savingPartial'))
      cacheWriter.schedule(path, event.payload.result)
    }).then((fn) => {
      if (disposed) fn()
      else unlistenPartial = fn
    }).catch(() => {})

    return () => {
      disposed = true
      unlistenProgress?.()
      unlistenPartial?.()
    }
  }, [cacheWriter])

  const entries = useMemo(() => result?.entries ?? [], [result])
  const focusedEntry = useMemo(
    () => entries.find((entry) => entry.path === focusedPath) ?? null,
    [entries, focusedPath]
  )
  const visibleEntries = useMemo(() => {
    if (!focusedEntry) return entries
    const nested = entries.filter((entry) => {
      if (entry.path === focusedEntry.path) return false
      return entry.path.startsWith(`${focusedEntry.path}/`) || entry.path.startsWith(`${focusedEntry.path}\\`)
    })
    return nested.length > 0 ? nested : [focusedEntry]
  }, [entries, focusedEntry])
  const visibleTotal = focusedEntry?.size ?? result?.total_size ?? 0
  const rects = useMemo(() => buildTreemap(visibleEntries, visibleTotal), [visibleEntries, visibleTotal])
  const largeFiles = useMemo(() => {
    const source = (result?.large_files?.length ? result.large_files : entries.filter((entry) => !entry.is_dir))
    return source.slice(0, 8)
  }, [entries, result])
  const breadcrumbPaths = useMemo(() => {
    if (!result) return []
    return [result.path, ...pathStack, ...(focusedPath ? [focusedPath] : [])]
  }, [focusedPath, pathStack, result])
  const targetPath = result?.path ?? directory
  const focusedLabel = focusedEntry?.name ?? (result?.path === SYSTEM_ANALYZE_PATH ? t('analyze.systemRoot') : result?.path ?? t('analyze.systemRoot'))

  const selectDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('analyze.dialogTitle'),
    })
    if (selected && typeof selected === 'string') {
      setDirectory(selected)
    }
  }

  const setAnalyzeResult = (next: MoleAnalyzeResult, info: string | null) => {
    setResult(compactAnalyzeResult(next))
    setFocusedPath(null)
    setPathStack([])
    setCacheInfo(info)
    setScanError(null)
  }

  const analyze = async (options: { force?: boolean; path?: string } = {}) => {
    const target = options.path ?? directory
    if (!target.trim()) {
      toast.info(t('analyze.needDir'))
      return
    }

    const trimmed = target.trim()
    setDirectory(trimmed)

    const runId = `analyze-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeRunIdRef.current = runId
    activeAnalyzePathRef.current = trimmed
    setAnalyzing(true)
    setFocusedPath(null)
    setPathStack([])
    setCacheInfo(options.force ? null : t('analyze.loadingSaved'))
    setProgress({
      runId,
      path: trimmed,
      phase: 'starting',
      elapsedSecs: 0,
    })
    setProgressLog([])
    setResult(null)

    await waitForPaint()

    const cached = options.force ? null : await getCachedAnalyze(trimmed)
    if (activeRunIdRef.current !== runId) return
    if (cached) {
      setAnalyzeResult(
        cached.result,
        options.force
          ? t('analyze.savedLoadedRescanning', { age: formatCacheAge(cached.createdAt) })
          : t('analyze.cacheHit', { age: formatCacheAge(cached.createdAt) })
      )
      if (!options.force) {
        setAnalyzing(false)
        setProgress(null)
        activeRunIdRef.current = null
        activeAnalyzePathRef.current = null
        return
      }
    } else {
      setCacheInfo(null)
    }

    await waitForPaint()
    if (activeRunIdRef.current !== runId) return

    try {
      setScanError(null)
      const next = compactAnalyzeResult(await invoke<MoleAnalyzeResult>('mole_analyze_json_stream', {
        runId,
        path: trimmed,
      }))
      if (activeRunIdRef.current !== runId) return
      await cacheWriter.saveNow(trimmed, next)
      if (activeRunIdRef.current !== runId) return
      setAnalyzeResult(next, options.force ? t('analyze.cacheRefresh') : null)
    } catch (err) {
      if (activeRunIdRef.current !== runId) return
      const message = String(err)
      setScanError(message)
      if (message.includes('Analysis cancelled')) {
        toast.info(t('analyze.cancelled'))
      } else {
        toast.error(t('analyze.fail', { error: message }))
      }
    } finally {
      if (activeRunIdRef.current === runId) {
        setAnalyzing(false)
        activeRunIdRef.current = null
        activeAnalyzePathRef.current = null
      }
    }
  }

  const reveal = (path: string) => {
    void openPath(path).catch(() => toast.error(t('analyze.openFail')))
  }

  const analyzeExternalVolumes = () => {
    void analyze({ path: '/Volumes', force: true })
  }

  const analyzeSystem = () => {
    void analyze({ path: SYSTEM_ANALYZE_PATH, force: true })
  }

  const analyzeCustom = () => {
    void analyze()
  }

  const forceRescanCurrent = () => {
    void analyze({ path: result?.path ?? (directory || SYSTEM_ANALYZE_PATH), force: true })
  }

  const cancelAnalyze = () => {
    const runId = activeRunIdRef.current
    if (!runId) return
    activeRunIdRef.current = null
    activeAnalyzePathRef.current = null
    setAnalyzing(false)
    setCacheInfo(t('analyze.cancelled'))
    setProgress((current) => current?.runId === runId ? { ...current, phase: 'cancelled' } : current)
    void invoke('mole_analyze_cancel', { runId }).catch((err) => toast.error(t('analyze.cancelFail', { error: String(err) })))
  }

  const drillInto = (entry: MoleAnalyzeEntry) => {
    if (!entry.is_dir) {
      reveal(entry.path)
      return
    }
    setPathStack((stack) => (focusedPath ? [...stack, focusedPath] : stack))
    setFocusedPath(entry.path)
  }

  const stepBack = () => {
    setPathStack((stack) => {
      const next = [...stack]
      const previous = next.pop() ?? null
      setFocusedPath(previous)
      return next
    })
  }

  const openEntryContextMenu = (event: MouseEvent, entry: MoleAnalyzeEntry) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, entry })
  }

  const retryEntry = (entry: MoleAnalyzeEntry) => {
    const target = entry.is_dir ? entry.path : parentPath(entry.path)
    void analyze({ path: target, force: true })
  }

  const trashEntryWithSupplement = async (entry: MoleAnalyzeEntry) => {
    const confirmed = window.confirm(
      t('analyze.trashConfirm', {
        name: entry.name,
        size: formatFileSize(entry.size),
      })
    )
    if (!confirmed) return

    try {
      const moved = await movePathToTrashWithStowMindSupplement(entry.path)
      toast.success(t('analyze.trashSuccess', { source: moved.source }))
      const target = result?.path ?? directory
      if (target.trim()) {
        await analyze({ path: target, force: true })
      }
    } catch (err) {
      toast.error(t('analyze.trashFail', { error: String(err) }))
    }
  }

  const openFullDiskAccessSettings = async () => {
    try {
      await invoke('open_system_settings', { target: 'full_disk_access' })
    } catch (err) {
      toast.error(t('analyze.openSettingsFail', { error: String(err) }))
    }
  }

  const handleBreadcrumb = (index: number, path: string) => {
    if (index === 0) {
      setFocusedPath(null)
      setPathStack([])
      return
    }
    setFocusedPath(path)
    setPathStack(breadcrumbPaths.slice(1, index))
  }

  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div className="min-w-0">
          <p className="iqon-eyebrow mb-1">{t('eyebrow.insights')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('analyze.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t('analyze.subtitle')}</p>
        </div>
      </div>

      <AnalyzeSystemView
        t={t}
        resultPath={result?.path ?? null}
        directory={directory}
        setDirectory={setDirectory}
        analyzing={analyzing}
        progress={progress}
        progressLog={progressLog}
        cacheInfo={cacheInfo}
        cacheLoading={cacheLoading}
        visibleEntries={visibleEntries}
        visibleTotal={visibleTotal}
        totalFiles={result?.total_files ?? 0}
        focusedPath={focusedPath}
        focusedLabel={focusedLabel}
        breadcrumbPaths={breadcrumbPaths}
        rects={rects}
        onAnalyzeSystem={analyzeSystem}
        onAnalyzeCustom={analyzeCustom}
        onAnalyzeExternalVolumes={analyzeExternalVolumes}
        onCancelAnalyze={cancelAnalyze}
        onSelectDirectory={() => void selectDirectory()}
        onStepBack={stepBack}
        onRevealCurrent={() => reveal(focusedEntry?.path ?? result?.path ?? targetPath)}
        onBreadcrumb={handleBreadcrumb}
        onDrillInto={drillInto}
        onEntryContextMenu={openEntryContextMenu}
      />

      {scanError && (
        <div className="iqon-card border-iqon-yellow/30 bg-iqon-yellow/5 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-iqon-yellow">
            <AlertTriangle className="h-5 w-5" />
            {isPermissionError(scanError) ? t('analyze.permissionTitle') : t('analyze.errorTitle')}
          </div>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {isPermissionError(scanError) ? t('analyze.permissionDesc') : scanError}
          </p>
          {isPermissionError(scanError) && (
            <p className="mt-2 break-words font-mono text-[10px] text-muted-foreground">{scanError}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={forceRescanCurrent} disabled={analyzing}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('analyze.retryScan')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void openFullDiskAccessSettings()}>
              {t('analyze.openPrivacySettings')}
            </Button>
          </div>
        </div>
      )}

      {result?.warnings?.length ? (
        <details className="iqon-card border-iqon-yellow/30 bg-iqon-yellow/5 px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-iqon-yellow">
            <AlertTriangle className="h-4 w-4" />
            <span>{t('analyze.warningInline', { count: result.warnings.length })}</span>
          </summary>
          <div className="iqon-row mt-3 max-h-28 space-y-1 overflow-y-auto p-3 font-mono text-[10px] text-muted-foreground">
            {result.warnings.slice(0, 8).map((warning, index) => (
              <p key={`${warning}-${index}`} className="break-words">{warning}</p>
            ))}
          </div>
        </details>
      ) : null}

      {result && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="iqon-card p-5">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-foreground">{t('analyze.resultsTitle')}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t('analyze.resultsListDesc')}</p>
            </div>
            <div className="space-y-2">
              {visibleEntries.slice(0, 12).map((entry) => (
                <AnalyzeRow
                  key={entry.path}
                  entry={entry}
                  total={visibleTotal}
                  t={t}
                  onOpen={() => drillInto(entry)}
                  onReveal={() => reveal(entry.path)}
                  onContextMenu={(event) => openEntryContextMenu(event, entry)}
                />
              ))}
            </div>
          </div>

          <div className="iqon-card p-5">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-foreground">{t('analyze.largeFilesTitle')}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t('analyze.largeFilesDesc')}</p>
            </div>
            <div className="space-y-2">
              {largeFiles.length > 0 ? (
                largeFiles.map((entry) => (
                  <AnalyzeRow
                    key={entry.path}
                    entry={entry}
                    total={result.total_size}
                    t={t}
                    onOpen={() => reveal(entry.path)}
                    onReveal={() => reveal(entry.path)}
                    onContextMenu={(event) => openEntryContextMenu(event, entry)}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-iqon-border bg-iqon-row p-6 text-center text-xs text-muted-foreground">
                  {t('analyze.emptyLargeFiles')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AnalyzeContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpen={drillInto}
        onReveal={(entry) => reveal(entry.path)}
        onRetry={retryEntry}
        onTrash={(entry) => void trashEntryWithSupplement(entry)}
      />
    </div>
  )
}
