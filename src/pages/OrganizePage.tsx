import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn, formatFileSize, pathRoughlyEqual } from '@/lib/utils'
import { FileItem, FolderItem, MoveRecord, OrganizeOutcome, useAppStore } from '@/stores/app'
import { open } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { ArrowRight, Brain, Eye, Folder, FolderOpen, Keyboard, Loader2, Play, RotateCcw, Scan, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'

interface ScanProgress {
  current: number
  total: number
  file_name: string
  status: 'scanning' | 'thinking' | 'classified' | 'grouping' | 'error'
  thinking?: string
  category?: string
}

interface OrganizeProgressEvent {
  current: number
  total: number
  path: string
  phase: 'files' | 'folders'
}

export function OrganizePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [directory, setDirectory] = useState('')
  const [files, setFiles] = useState<FileItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [organizing, setOrganizing] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [thinkingText, setThinkingText] = useState('')
  const [useAI, setUseAI] = useState(false)
  const [organizeFolders, setOrganizeFolders] = useState(false)
  const [showTempFiles, setShowTempFiles] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMoves, setPreviewMoves] = useState<MoveRecord[]>([])
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [organizePhase, setOrganizePhase] = useState<'idle' | 'preview' | 'execute'>('idle')
  const [organizeProgress, setOrganizeProgress] = useState<OrganizeProgressEvent | null>(null)

  const aiProvider = useAppStore((s) => s.aiProvider)
  const categories = useAppStore((s) => s.categories)
  const aiOnlyHardCases = useAppStore((s) => s.aiOnlyHardCases)
  const addHistory = useAppStore((s) => s.addHistory)
  const updateStatistics = useAppStore((s) => s.updateStatistics)
  const statistics = useAppStore((s) => s.statistics)
  const history = useAppStore((s) => s.history)
  const markUndone = useAppStore((s) => s.markUndone)
  const lastOrganizeRecordId = useAppStore((s) => s.lastOrganizeRecordId)
  const setLastOrganizeRecordId = useAppStore((s) => s.setLastOrganizeRecordId)
  const scanRecursive = useAppStore((s) => s.scanRecursive)
  const setScanRecursive = useAppStore((s) => s.setScanRecursive)
  const excludePatterns = useAppStore((s) => s.excludePatterns)
  const backupBeforeOrganize = useAppStore((s) => s.backupBeforeOrganize)
  const backupDirectory = useAppStore((s) => s.backupDirectory)
  const [undoingLast, setUndoingLast] = useState(false)

  useEffect(() => {
    const unlisten = listen<ScanProgress>('scan-progress', (event) => {
      const data = event.payload
      setProgress(data)

      if (data.status === 'thinking' && data.thinking) {
        setThinkingText(prev => prev + data.thinking)
      } else if (data.status === 'classified' || data.status === 'error') {
        setThinkingText('')
      }
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  useEffect(() => {
    const unlisten = listen<OrganizeProgressEvent>('organize-progress', (event) => {
      setOrganizeProgress(event.payload)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const selectDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('organize.dialogTitle')
    })
    if (selected && typeof selected === 'string') {
      setDirectory(selected)
      setFiles([])
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const items = e.dataTransfer.items
    if (items?.length) {
      const entry = items[0].webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        // Tauri injects `path` on File objects for native drag-and-drop
        const file = e.dataTransfer.files[0] as File & { path?: string }
        if (file?.path) {
          setDirectory(file.path)
          setFiles([])
          setFolders([])
        }
      }
    }
  }

  const scanDirectory = async () => {
    if (!directory) return

    setScanning(true)
    setProgress(null)
    setThinkingText('')
    setFiles([])
    setFolders([])

    try {
      const fileResult = await invoke<FileItem[]>('scan_directory', {
        directory,
        useAi: useAI,
        aiOnlyHardCases: aiOnlyHardCases,
        aiProvider: aiProvider,
        categories,
        showTempFiles: showTempFiles,
        recursive: scanRecursive,
        excludePatterns: excludePatterns
      })
      setFiles(fileResult)

      if (organizeFolders) {
        const folderResult = await invoke<FolderItem[]>('scan_folders_cmd', {
          directory,
          categories
        })
        setFolders(folderResult)
      }
    } catch (error) {
      console.error('Scan failed:', error)
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }

  const setFileCategory = (path: string, category: string) => {
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, category } : f)))
  }

  const setFolderCategory = (path: string, category: string) => {
    setFolders((prev) => prev.map((f) => (f.path === path ? { ...f, category } : f)))
  }

  const setFileSkip = (path: string, skip: boolean) => {
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, skip } : f)))
  }

  const setFolderSkip = (path: string, skip: boolean) => {
    setFolders((prev) => prev.map((f) => (f.path === path ? { ...f, skip } : f)))
  }

  const activeFiles = useMemo(() => files.filter((f) => !f.skip), [files])
  const activeFolders = useMemo(() => folders.filter((f) => !f.skip), [folders])
  const movingCount = activeFiles.length + activeFolders.length

  const fileForApi = (f: FileItem): FileItem => {
    const { skip: _s, ...rest } = f
    return rest
  }
  const folderForApi = (f: FolderItem): FolderItem => {
    const { skip: _s, ...rest } = f
    return rest
  }

  const runOrganize = async (dryRun: boolean, opts?: { skipInitialConfirm?: boolean }) => {
    if (files.length === 0 && folders.length === 0) return

    if (movingCount === 0) {
      toast.info(t('organize.noItemsToMove'))
      return
    }

    if (!dryRun && !opts?.skipInitialConfirm) {
      const confirmed = window.confirm(t('organize.confirmMsg', { n: movingCount }))
      if (!confirmed) return
      setLastOrganizeRecordId(null)
    }

    setOrganizing(true)
    setOrganizePhase(dryRun ? 'preview' : 'execute')
    setOrganizeProgress(null)

    try {
      const allMoves: MoveRecord[] = []
      const allErrors: string[] = []

      const filesPayload = activeFiles.map(fileForApi)
      const foldersPayload = activeFolders.map(folderForApi)

      const useBackup =
        !dryRun &&
        backupBeforeOrganize &&
        backupDirectory.trim().length > 0
      if (!dryRun && backupBeforeOrganize && backupDirectory.trim().length === 0) {
        toast.warning(t('organize.backupPathMissing'))
      }
      const backupSessionId = useBackup ? Date.now().toString() : undefined
      const backupPayload =
        useBackup && backupSessionId
          ? { backupDirectory: backupDirectory.trim(), backupSessionId: backupSessionId }
          : { backupDirectory: null as string | null, backupSessionId: null as string | null }

      if (filesPayload.length > 0) {
        const out = await invoke<OrganizeOutcome>('organize_files', {
          directory,
          files: filesPayload,
          dryRun: dryRun,
          ...backupPayload
        })
        allMoves.push(...out.moves)
        allErrors.push(...out.errors)
      }

      if (foldersPayload.length > 0) {
        const out = await invoke<OrganizeOutcome>('organize_folders', {
          directory,
          folders: foldersPayload,
          dryRun: dryRun,
          ...backupPayload
        })
        allMoves.push(...out.moves)
        allErrors.push(...out.errors)
      }

      if (dryRun) {
        setPreviewMoves(allMoves)
        setPreviewErrors(allErrors)
        if (allMoves.length > 0 || allErrors.length > 0) {
          setPreviewOpen(true)
        }
        if (allMoves.length === 0 && allErrors.length === 0) {
          toast.info(t('organize.nothingDone'))
        }
        return
      }

      const okCount = allMoves.length
      const failCount = allErrors.length

      let sizeOk = 0
      const successesByCategory: Record<string, number> = {}
      const snapshotFiles = files
      const snapshotFolders = folders
      for (const m of allMoves) {
        const fi = snapshotFiles.find((f) => pathRoughlyEqual(f.path, m.from))
        if (fi) {
          sizeOk += fi.size
          successesByCategory[fi.category] = (successesByCategory[fi.category] || 0) + 1
        }
        const fo = snapshotFolders.find((f) => pathRoughlyEqual(f.path, m.from))
        if (fo) {
          sizeOk += fo.totalSize
          successesByCategory[fo.category] = (successesByCategory[fo.category] || 0) + 1
        }
      }

      const categoryCounts = { ...statistics.categoryCounts }
      for (const [cat, n] of Object.entries(successesByCategory)) {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + n
      }

      if (okCount > 0) {
        updateStatistics({
          totalFilesOrganized: statistics.totalFilesOrganized + okCount,
          totalSizeOrganized: statistics.totalSizeOrganized + sizeOk,
          categoryCounts,
          lastOrganized: new Date().toISOString()
        })
      }

      const recordId = `${Date.now()}`
      if (okCount > 0 || failCount > 0) {
        addHistory({
          id: recordId,
          timestamp: new Date().toISOString(),
          directory,
          totalFiles: okCount,
          categories: successesByCategory,
          executed: true,
          moves: allMoves,
          organizeErrors: failCount > 0 ? allErrors : undefined
        })
      }
      if (okCount > 0) {
        setLastOrganizeRecordId(recordId)
      }

      if (failCount === 0 && okCount > 0) {
        const movedFrom = new Set(allMoves.map((m) => m.from))
        const nextFiles = snapshotFiles.filter((f) => f.skip || !movedFrom.has(f.path))
        const nextFolders = snapshotFolders.filter((f) => f.skip || !movedFrom.has(f.path))
        const kept = nextFiles.length + nextFolders.length
        setFiles(nextFiles)
        setFolders(nextFolders)
        if (kept === 0) {
          setDirectory('')
          toast.success(t('organize.successMsg', { n: okCount }))
          setTimeout(() => navigate('/history', { state: { fromOrganize: true } }), 1500)
        } else {
          toast.success(t('organize.successKeptInList', { n: okCount, k: kept }))
        }
      } else if (okCount > 0 && failCount > 0) {
        toast.warning(
          t('organize.partialMsg', { ok: okCount, fail: failCount }) +
            '\n' +
            allErrors.slice(0, 8).join('\n') +
            (failCount > 8 ? `\n…+${failCount - 8}` : '')
        )
      } else if (okCount === 0 && failCount > 0) {
        toast.error(
          t('organize.allFailedMsg', { n: failCount }) +
            '\n' +
            allErrors.slice(0, 10).join('\n')
        )
      } else {
        toast.info(t('organize.nothingDone'))
      }
    } catch (error) {
      console.error('Organize failed:', error)
      toast.error(t('organize.failMsg', { error: String(error) }))
    } finally {
      setOrganizing(false)
      setOrganizePhase('idle')
      setOrganizeProgress(null)
    }
  }

  const runOrganizeRef = useRef(runOrganize)
  runOrganizeRef.current = runOrganize

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"]')) return
      if (previewOpen || organizing || scanning) return
      if (movingCount === 0) return
      e.preventDefault()
      runOrganizeRef.current(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewOpen, organizing, scanning, movingCount])

  const runPreview = () => void runOrganize(true)

  const applyAfterPreview = () => {
    if (!window.confirm(t('organize.confirmAfterPreview'))) return
    setPreviewOpen(false)
    setLastOrganizeRecordId(null)
    void runOrganize(false, { skipInitialConfirm: true })
  }

  const organizeFiles = () => void runOrganize(false)

  const groupedFiles = files.reduce((acc, file) => {
    if (!acc[file.category]) acc[file.category] = []
    acc[file.category].push(file)
    return acc
  }, {} as Record<string, FileItem[]>)

  const progressPercent = progress ? (progress.current / progress.total) * 100 : 0

  const methodLabel = (m: string) => {
    switch (m) {
      case 'ai': return t('organize.methodAI')
      case 'group': return t('organize.methodGroup')
      case 'fallback': return t('organize.methodFallback')
      default: return t('organize.methodRule')
    }
  }

  const lastOrganizeRecord = lastOrganizeRecordId
    ? history.find((r) => r.id === lastOrganizeRecordId)
    : undefined
  const showUndoBanner = Boolean(
    lastOrganizeRecord &&
      lastOrganizeRecord.executed &&
      !lastOrganizeRecord.undone &&
      (lastOrganizeRecord.moves?.length ?? 0) > 0
  )

  const handleUndoLastOrganize = useCallback(async () => {
    if (!lastOrganizeRecord?.moves?.length) return
    const confirmed = window.confirm(
      t('history.undoConfirm', { n: lastOrganizeRecord.moves.length })
    )
    if (!confirmed) return
    setUndoingLast(true)
    try {
      const errors = await invoke<string[]>('undo_organize', {
        records: lastOrganizeRecord.moves,
      })
      markUndone(lastOrganizeRecord.id)
      if (errors.length > 0) {
        toast.warn(t('history.undoPartialFail', { n: errors.length }))
      } else {
        toast.success(t('history.undoSuccess'))
      }
    } catch (e) {
      toast.error(t('history.undoFail', { error: String(e) }))
    } finally {
      setUndoingLast(false)
    }
  }, [lastOrganizeRecord, markUndone, t])

  const showGuideCard = files.length === 0 && folders.length === 0 && !scanning
  const organizeProgressPercent = organizeProgress
    ? (organizeProgress.current / Math.max(organizeProgress.total, 1)) * 100
    : 0

  return (
    <div
      className="stow-page-wide relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => { setDragOver(false); handleDrop(e) }}
    >
      {previewOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="iqon-card flex max-h-[85vh] w-full max-w-3xl flex-col">
            <div className="shrink-0 space-y-1 border-b border-iqon-border p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="iqon-eyebrow">{t('organize.previewTitle')}</p>
                  <h3 className="mt-1 text-base font-bold text-foreground">
                    {t('organize.previewHint', { n: previewMoves.length })}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-iqon-row hover:text-foreground"
                  aria-label={t('organize.previewClose')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {previewMoves.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-iqon-border">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-iqon-row">
                      <tr>
                        <th className="w-[45%] p-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t('organize.previewFrom')}
                        </th>
                        <th className="w-[45%] p-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t('organize.previewTo')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewMoves.map((m, i) => (
                        <tr key={`${m.from}-${i}`} className="border-t border-iqon-border align-top hover:bg-iqon-row">
                          <td className="break-all p-3 font-mono text-[11px] text-muted-foreground">{m.from}</td>
                          <td className="break-all p-3 font-mono text-[11px] text-foreground">{m.to}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {previewErrors.length > 0 && (
                <div className="iqon-card border-iqon-red/30 bg-iqon-red/5 p-3">
                  <p className="text-xs font-bold text-iqon-red">{t('organize.previewErrors')}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
                    {previewErrors.map((e, i) => (
                      <li key={i} className="break-words">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-iqon-border p-4">
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
                {t('organize.previewClose')}
              </Button>
              <Button size="sm" onClick={applyAfterPreview} disabled={previewMoves.length === 0}>
                {t('organize.previewExecute')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-iqon-green bg-iqon-green/10 backdrop-blur-sm">
          <div className="text-center">
            <FolderOpen className="mx-auto mb-3 h-16 w-16 text-iqon-green" />
            <p className="text-base font-bold text-iqon-green">{t('organize.dialogTitle')}</p>
          </div>
        </div>
      )}
      <div>
        <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('organize.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('organize.subtitle')}</p>
      </div>

      {showGuideCard && (
        <div className="iqon-card border-dashed bg-iqon-row p-5">
          <h3 className="text-sm font-bold text-foreground">{t('organize.guideTitle')}</h3>
          <div className="mt-3 space-y-3 text-xs text-muted-foreground">
            {!directory ? (
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>{t('organize.guideStep1')}</li>
                <li>{t('organize.guideStep2')}</li>
                <li>{t('organize.guideStep3')}</li>
                <li>{t('organize.guideStep4')}</li>
              </ol>
            ) : (
              <p>{t('organize.guideAfterDir')}</p>
            )}
            <p className="flex items-center gap-2 border-t border-iqon-border pt-3 text-[11px]">
              <Keyboard className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('organize.shortcutHint')}
            </p>
          </div>
        </div>
      )}

      {showUndoBanner && lastOrganizeRecord && (
        <div className="iqon-card flex flex-col gap-3 border-iqon-yellow/30 bg-iqon-yellow/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-iqon-yellow">
              <Undo2 className="h-4 w-4" />
              {t('organize.undoBannerTitle')}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('organize.undoBannerHint', { n: lastOrganizeRecord.moves.length })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              disabled={undoingLast}
              onClick={() => void handleUndoLastOrganize()}
            >
              {undoingLast ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="mr-2 h-4 w-4" />
              )}
              {t('organize.undoBannerBtn')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/history')}>
              {t('organize.undoBannerHistory')}
            </Button>
          </div>
        </div>
      )}

      <div className="iqon-card p-5">
        <h3 className="mb-4 text-sm font-bold text-foreground">{t('organize.selectDir')}</h3>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder={t('organize.inputPlaceholder')}
              className="flex-1 font-mono text-xs"
            />
            <Button variant="outline" onClick={selectDirectory}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('organize.browse')}
            </Button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="iqon-row flex cursor-pointer items-center gap-2 px-3 py-2">
                <Switch checked={useAI} onCheckedChange={setUseAI} />
                <span className="text-xs font-bold">{t('organize.aiClassify')}</span>
              </label>
              <label className="iqon-row flex cursor-pointer items-center gap-2 px-3 py-2">
                <Switch checked={organizeFolders} onCheckedChange={setOrganizeFolders} />
                <span className="text-xs font-bold">{t('organize.subFolders')}</span>
              </label>
              <label className="iqon-row flex cursor-pointer items-center gap-2 px-3 py-2">
                <Switch checked={showTempFiles} onCheckedChange={setShowTempFiles} />
                <span className="text-xs font-bold">{t('organize.showTemp')}</span>
              </label>
              <label className="iqon-row flex cursor-pointer items-start gap-2 px-3 py-2">
                <Switch checked={scanRecursive} onCheckedChange={setScanRecursive} />
                <div>
                  <p className="text-xs font-bold">{t('organize.recursiveScan')}</p>
                  <p className="max-w-[20rem] text-[10px] text-muted-foreground">
                    {t('organize.recursiveScanHint')}
                  </p>
                </div>
              </label>
            </div>

            <Button onClick={scanDirectory} disabled={!directory || scanning} className="shrink-0">
              {scanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Scan className="mr-2 h-4 w-4" />
              )}
              {scanning ? t('organize.scanning') : t('organize.scanFiles')}
            </Button>
          </div>
        </div>
      </div>

      {scanning && progress && (
        <div className="iqon-card border-iqon-cyan/30 bg-iqon-cyan/5 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              {useAI ? (
                <>
                  <Brain className="h-4 w-4 animate-pulse text-iqon-cyan" />
                  {t('organize.aiAnalyzing')}
                </>
              ) : (
                <>
                  <Scan className="h-4 w-4 animate-pulse text-iqon-cyan" />
                  {t('organize.nowScanning')}
                </>
              )}
            </div>
            <span className="iqon-pill border-iqon-cyan/40 text-iqon-cyan">
              {progress.current} / {progress.total}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="iqon-eyebrow shrink-0">{t('organize.currentFile')}</span>
              <span className="max-w-md truncate font-mono text-foreground">{progress.file_name}</span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
          </div>

          <div className="mt-4 text-xs">
            {progress.status === 'scanning' && (
              <span className="flex items-center gap-2 text-iqon-cyan">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('organize.readingInfo')}
              </span>
            )}

            {progress.status === 'thinking' && useAI && (
              <div className="space-y-2">
                <span className="flex items-center gap-2 text-iqon-yellow">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('organize.aiThinking')}
                </span>
                {thinkingText && (
                  <div className="iqon-row max-h-32 overflow-y-auto p-3">
                    <p className="whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                      {thinkingText.slice(-500)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {progress.status === 'classified' && progress.category && (
              <span className="flex items-center gap-2 text-iqon-green">
                {t('organize.classifiedAs')}
                <span className="iqon-pill border-iqon-green/40 text-iqon-green">{progress.category}</span>
              </span>
            )}

            {progress.status === 'grouping' && (
              <span className="flex items-center gap-2 text-iqon-purple">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('organize.analyzingSimilarity')}
              </span>
            )}

            {progress.status === 'error' && progress.thinking && (
              <span className="text-iqon-red">{progress.thinking}</span>
            )}
          </div>
        </div>
      )}

      {organizing && (
        <div className="iqon-card border-iqon-green/30 bg-iqon-green/5 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-iqon-green" />
            {t('organize.organizeProgressTitle')}
          </div>
          {organizeProgress ? (
            <div className="space-y-2">
              <div className="flex justify-between gap-2 text-[11px]">
                <span className="iqon-eyebrow">
                  {organizeProgress.phase === 'files'
                    ? t('organize.organizePhaseFiles')
                    : t('organize.organizePhaseFolders')}
                </span>
                <span className="shrink-0 font-mono text-foreground">
                  {organizeProgress.current} / {organizeProgress.total}
                </span>
              </div>
              <Progress value={organizeProgressPercent} className="h-1.5" />
              <p
                className="truncate font-mono text-[10px] text-muted-foreground"
                title={organizeProgress.path}
              >
                {organizeProgress.path}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('organize.organizing')}</p>
          )}
        </div>
      )}

      {(files.length > 0 || folders.length > 0) && (
        <div className="iqon-card p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {t('organize.resultTitle')} ({t('organize.nFiles', { n: files.length })}
                {folders.length > 0 ? `, ${t('organize.nFolders', { n: folders.length })}` : ''})
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('organize.resultMoving', {
                  moving: movingCount,
                  total: files.length + folders.length
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { setFiles([]); setFolders([]) }}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t('organize.reset')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={runPreview}
                disabled={organizing || scanning || movingCount === 0}
              >
                {organizePhase === 'preview' && organizing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                {t('organize.preview')}
              </Button>
              <Button
                size="sm"
                onClick={organizeFiles}
                disabled={organizing || scanning || movingCount === 0}
              >
                {organizePhase === 'execute' && organizing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {organizePhase === 'execute' && organizing ? t('organize.organizing') : t('organize.execute')}
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            {folders.length > 0 && (
              <div className="space-y-3 border-b border-iqon-border pb-5">
                <p className="iqon-eyebrow">{t('organize.subFolderLabel')}</p>
                {Object.entries(
                  folders.reduce((acc, folder) => {
                    if (!acc[folder.category]) acc[folder.category] = []
                    acc[folder.category].push(folder)
                    return acc
                  }, {} as Record<string, FolderItem[]>)
                ).map(([category, categoryFolders]) => {
                  const cat = categories.find(c => c.name === category)
                  return (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-iqon-cyan/30 bg-iqon-cyan/10 text-iqon-cyan">
                          {cat?.icon || <Folder className="h-4 w-4" />}
                        </span>
                        <span className="text-sm font-bold text-foreground">{category}</span>
                        <span className="iqon-pill border-iqon-cyan/40 text-iqon-cyan">{categoryFolders.length}</span>
                      </div>
                      <div className="max-h-32 space-y-1.5 overflow-y-auto pl-2">
                        {categoryFolders.map((folder) => (
                          <div
                            key={folder.path}
                            className={cn(
                              'iqon-row iqon-row-hover flex flex-wrap items-center gap-2 px-3 py-2 text-xs',
                              folder.skip && 'opacity-60'
                            )}
                          >
                            <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={Boolean(folder.skip)}
                                onChange={(e) => setFolderSkip(folder.path, e.target.checked)}
                                className="iqon-checkbox"
                                aria-label={t('organize.skipThisRun')}
                              />
                              <span className="sr-only">{t('organize.skipThisRun')}</span>
                            </label>
                            <div className="flex min-w-0 flex-1 basis-[10rem] items-center gap-2">
                              <Folder className="h-4 w-4 shrink-0 text-iqon-cyan" />
                              <span className="max-w-md truncate font-bold text-foreground">{folder.name}</span>
                            </div>
                            <div className="w-[min(100%,10rem)] shrink-0 sm:w-40">
                              <Select
                                value={folder.category}
                                onValueChange={(v) => setFolderCategory(folder.path, v)}
                              >
                                <SelectTrigger className="h-8 text-xs" aria-label={t('organize.categoryColumn')}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {categories.map((c) => (
                                    <SelectItem key={c.name} value={c.name}>
                                      <span className="mr-1">{c.icon}</span>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-3 font-mono text-[10px] text-muted-foreground">
                              <span>{t('organize.nFiles', { n: folder.fileCount })}</span>
                              <span className="font-bold text-foreground">{formatFileSize(folder.totalSize)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {Object.entries(groupedFiles).map(([category, categoryFiles]) => {
              const cat = categories.find(c => c.name === category)

              const bySubFolder = categoryFiles.reduce((acc, file) => {
                const key = file.subFolder || '_root'
                if (!acc[key]) acc[key] = []
                acc[key].push(file)
                return acc
              }, {} as Record<string, FileItem[]>)

              return (
                <div key={category} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-iqon-green/30 bg-iqon-green/10 text-iqon-green">
                      {cat?.icon || <Folder className="h-4 w-4" />}
                    </span>
                    <span className="text-sm font-bold text-foreground">{category}</span>
                    <span className="iqon-pill border-iqon-green/40 text-iqon-green">{categoryFiles.length}</span>
                  </div>

                  <div className="space-y-3 pl-2">
                    {Object.entries(bySubFolder).map(([subFolder, subFiles]) => (
                      <div key={subFolder} className="space-y-1">
                        {subFolder !== '_root' && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <FolderOpen className="h-3.5 w-3.5" />
                            <span className="font-bold">{subFolder}</span>
                            <span className="iqon-pill text-[9px]">
                              {t('organize.nSimilar', { n: subFiles.length })}
                            </span>
                          </div>
                        )}
                        <div className={cn('max-h-48 space-y-1.5 overflow-y-auto', subFolder !== '_root' && 'pl-5')}>
                          {subFiles.map((file) => {
                            const dest = [file.category, subFolder !== '_root' ? subFolder : null, file.name]
                              .filter(Boolean)
                              .join('/')
                            return (
                              <div
                                key={file.path}
                                className={cn(
                                  'iqon-row iqon-row-hover flex flex-wrap items-center gap-2 px-3 py-2 text-xs',
                                  file.skip && 'opacity-60'
                                )}
                              >
                                <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(file.skip)}
                                    onChange={(e) => setFileSkip(file.path, e.target.checked)}
                                    className="iqon-checkbox"
                                    aria-label={t('organize.skipThisRun')}
                                  />
                                  <span className="sr-only">{t('organize.skipThisRun')}</span>
                                </label>
                                <div className="min-w-0 flex-1 basis-[12rem]">
                                  <span className="block max-w-md truncate font-bold text-foreground">{file.name}</span>
                                  <span className="block max-w-md truncate font-mono text-[10px] text-muted-foreground">
                                    <ArrowRight className="mr-1 inline h-3 w-3" />
                                    {dest}
                                  </span>
                                </div>
                                <div className="w-[min(100%,10rem)] shrink-0 sm:w-40">
                                  <Select
                                    value={file.category}
                                    onValueChange={(v) => setFileCategory(file.path, v)}
                                  >
                                    <SelectTrigger className="h-8 text-xs" aria-label={t('organize.categoryColumn')}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {categories.map((c) => (
                                        <SelectItem key={c.name} value={c.name}>
                                          <span className="mr-1">{c.icon}</span>
                                          {c.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                                  <span className="font-mono font-bold text-foreground">{formatFileSize(file.size)}</span>
                                  <span className={cn(
                                    'iqon-pill text-[9px]',
                                    file.method === 'ai' ? 'border-iqon-purple/40 text-iqon-purple' : ''
                                  )}>
                                    {methodLabel(file.method)}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
