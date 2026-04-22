import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { formatFileSize, pathRoughlyEqual } from '@/lib/utils'
import { FileItem, FolderItem, MoveRecord, OrganizeOutcome, useAppStore } from '@/stores/app'
import { open } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { Brain, Eye, Folder, FolderOpen, Keyboard, Loader2, Play, RotateCcw, Scan, Undo2 } from 'lucide-react'
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
  const [useAI, setUseAI] = useState(true)
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
        use_ai: useAI,
        ai_only_hard_cases: aiOnlyHardCases,
        ai_provider: aiProvider,
        categories,
        show_temp_files: showTempFiles,
        recursive: scanRecursive,
        exclude_patterns: excludePatterns
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
          ? { backup_directory: backupDirectory.trim(), backup_session_id: backupSessionId }
          : { backup_directory: null as string | null, backup_session_id: null as string | null }

      if (filesPayload.length > 0) {
        const out = await invoke<OrganizeOutcome>('organize_files', {
          directory,
          files: filesPayload,
          dry_run: dryRun,
          ...backupPayload
        })
        allMoves.push(...out.moves)
        allErrors.push(...out.errors)
      }

      if (foldersPayload.length > 0) {
        const out = await invoke<OrganizeOutcome>('organize_folders', {
          directory,
          folders: foldersPayload,
          dry_run: dryRun,
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
      className="p-6 space-y-6 relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => { setDragOver(false); handleDrop(e) }}
    >
      {previewOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-3xl max-h-[85vh] flex flex-col shadow-lg border-border">
            <CardHeader className="shrink-0 space-y-1">
              <CardTitle className="text-lg">{t('organize.previewTitle')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('organize.previewHint', { n: previewMoves.length })}
              </p>
            </CardHeader>
            <CardContent className="overflow-y-auto flex-1 min-h-0 space-y-3">
              {previewMoves.length > 0 && (
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium w-[45%]">{t('organize.previewFrom')}</th>
                        <th className="text-left p-2 font-medium w-[45%]">{t('organize.previewTo')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewMoves.map((m, i) => (
                        <tr key={`${m.from}-${i}`} className="border-t border-border align-top">
                          <td className="p-2 break-all font-mono text-xs">{m.from}</td>
                          <td className="p-2 break-all font-mono text-xs">{m.to}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {previewErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive mb-2">{t('organize.previewErrors')}</p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    {previewErrors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
            <div className="flex flex-wrap justify-end gap-2 p-4 border-t shrink-0">
              <Button variant="outline" onClick={() => setPreviewOpen(false)}>
                {t('organize.previewClose')}
              </Button>
              <Button onClick={applyAfterPreview} disabled={previewMoves.length === 0}>
                {t('organize.previewExecute')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg backdrop-blur-sm">
          <div className="text-center">
            <FolderOpen className="w-16 h-16 mx-auto text-primary mb-3" />
            <p className="text-lg font-medium text-primary">{t('organize.dialogTitle')}</p>
          </div>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold">{t('organize.title')}</h1>
        <p className="text-muted-foreground">{t('organize.subtitle')}</p>
      </div>

      {showGuideCard && (
        <Card className="bg-muted/30 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('organize.guideTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            {!directory ? (
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>{t('organize.guideStep1')}</li>
                <li>{t('organize.guideStep2')}</li>
                <li>{t('organize.guideStep3')}</li>
                <li>{t('organize.guideStep4')}</li>
              </ol>
            ) : (
              <p>{t('organize.guideAfterDir')}</p>
            )}
            <p className="flex items-center gap-2 pt-1 text-xs border-t border-border/60">
              <Keyboard className="w-4 h-4 shrink-0" aria-hidden />
              {t('organize.shortcutHint')}
            </p>
          </CardContent>
        </Card>
      )}

      {showUndoBanner && lastOrganizeRecord && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-100">
              {t('organize.undoBannerTitle')}
            </p>
            <p className="text-muted-foreground mt-1">
              {t('organize.undoBannerHint', { n: lastOrganizeRecord.moves.length })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              variant="default"
              size="sm"
              disabled={undoingLast}
              onClick={() => void handleUndoLastOrganize()}
            >
              {undoingLast ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Undo2 className="w-4 h-4 mr-2" />
              )}
              {t('organize.undoBannerBtn')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/history')}>
              {t('organize.undoBannerHistory')}
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('organize.selectDir')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder={t('organize.inputPlaceholder')}
              className="flex-1"
            />
            <Button variant="outline" onClick={selectDirectory}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {t('organize.browse')}
            </Button>
          </div>
          
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={useAI} onCheckedChange={setUseAI} />
                <span className="text-sm">{t('organize.aiClassify')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={organizeFolders} onCheckedChange={setOrganizeFolders} />
                <span className="text-sm">{t('organize.subFolders')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={showTempFiles} onCheckedChange={setShowTempFiles} />
                <span className="text-sm">{t('organize.showTemp')}</span>
              </div>
              <div className="flex items-start gap-2">
                <Switch checked={scanRecursive} onCheckedChange={setScanRecursive} />
                <div>
                  <span className="text-sm">{t('organize.recursiveScan')}</span>
                  <p className="text-xs text-muted-foreground max-w-[20rem]">
                    {t('organize.recursiveScanHint')}
                  </p>
                </div>
              </div>
            </div>

            <Button onClick={scanDirectory} disabled={!directory || scanning} className="shrink-0">
              {scanning ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Scan className="w-4 h-4 mr-2" />
              )}
              {scanning ? t('organize.scanning') : t('organize.scanFiles')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {scanning && progress && (
        <Card className="border-primary/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {useAI ? (
                  <>
                    <Brain className="w-5 h-5 text-primary animate-pulse" />
                    {t('organize.aiAnalyzing')}
                  </>
                ) : (
                  <>
                    <Scan className="w-5 h-5 text-primary animate-pulse" />
                    {t('organize.nowScanning')}
                  </>
                )}
              </CardTitle>
              <Badge variant="outline">
                {progress.current} / {progress.total}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('organize.currentFile')}</span>
                <span className="font-medium truncate max-w-md">{progress.file_name}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
            
            <div className="flex items-center gap-2 text-sm">
              {progress.status === 'scanning' && (
                <span className="text-blue-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('organize.readingInfo')}
                </span>
              )}
              
              {progress.status === 'thinking' && useAI && (
                <div className="space-y-2 w-full">
                  <span className="text-yellow-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('organize.aiThinking')}
                  </span>
                  {thinkingText && (
                    <div className="bg-muted/50 rounded-lg p-3 max-h-32 overflow-y-auto">
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                        {thinkingText.slice(-500)}
                      </p>
                    </div>
                  )}
                </div>
              )}
              
              {progress.status === 'classified' && progress.category && (
                <span className="text-green-500 flex items-center gap-2">
                  {t('organize.classifiedAs')} <Badge>{progress.category}</Badge>
                </span>
              )}
              
              {progress.status === 'grouping' && (
                <span className="text-purple-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('organize.analyzingSimilarity')}
                </span>
              )}
              
              {progress.status === 'error' && progress.thinking && (
                <span className="text-red-500">{progress.thinking}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {organizing && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              {t('organize.organizeProgressTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {organizeProgress ? (
              <>
                <div className="flex justify-between text-xs text-muted-foreground gap-2">
                  <span>
                    {organizeProgress.phase === 'files'
                      ? t('organize.organizePhaseFiles')
                      : t('organize.organizePhaseFolders')}
                  </span>
                  <span className="shrink-0">
                    {organizeProgress.current} / {organizeProgress.total}
                  </span>
                </div>
                <Progress value={organizeProgressPercent} className="h-2" />
                <p
                  className="text-xs font-mono truncate text-muted-foreground"
                  title={organizeProgress.path}
                >
                  {organizeProgress.path}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('organize.organizing')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {(files.length > 0 || folders.length > 0) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>
                {t('organize.resultTitle')} ({t('organize.nFiles', { n: files.length })}
                {folders.length > 0 ? `, ${t('organize.nFolders', { n: folders.length })}` : ''})
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {t('organize.resultMoving', {
                  moving: movingCount,
                  total: files.length + folders.length
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { setFiles([]); setFolders([]) }}>
                <RotateCcw className="w-4 h-4 mr-2" />
                {t('organize.reset')}
              </Button>
              <Button
                variant="outline"
                onClick={runPreview}
                disabled={organizing || scanning || movingCount === 0}
              >
                {organizePhase === 'preview' && organizing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4 mr-2" />
                )}
                {t('organize.preview')}
              </Button>
              <Button
                onClick={organizeFiles}
                disabled={organizing || scanning || movingCount === 0}
              >
                {organizePhase === 'execute' && organizing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {organizePhase === 'execute' && organizing ? t('organize.organizing') : t('organize.execute')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {folders.length > 0 && (
                <div className="space-y-2 pb-4 border-b">
                  <h3 className="font-medium text-sm text-muted-foreground">{t('organize.subFolderLabel')}</h3>
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
                          <span className="text-xl">{cat?.icon || '📁'}</span>
                          <span className="font-medium">{category}</span>
                          <Badge variant="secondary">{categoryFolders.length}</Badge>
                        </div>
                        <div className="pl-8 space-y-1 max-h-32 overflow-y-auto">
                          {categoryFolders.map((folder) => (
                            <div
                              key={folder.path}
                              className={`flex flex-wrap items-center gap-2 p-2 rounded bg-muted/50 text-sm ${
                                folder.skip ? 'opacity-60' : ''
                              }`}
                            >
                              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(folder.skip)}
                                  onChange={(e) => setFolderSkip(folder.path, e.target.checked)}
                                  className="h-4 w-4 rounded border border-input"
                                  aria-label={t('organize.skipThisRun')}
                                />
                                <span className="sr-only">{t('organize.skipThisRun')}</span>
                              </label>
                              <div className="flex items-center gap-2 min-w-0 flex-1 basis-[10rem]">
                                <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                                <span className="truncate max-w-md">{folder.name}</span>
                              </div>
                              <div className="w-[min(100%,10rem)] sm:w-40 shrink-0">
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
                              <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-auto">
                                <span>{t('organize.nFiles', { n: folder.fileCount })}</span>
                                <span>{formatFileSize(folder.totalSize)}</span>
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
                      <span className="text-xl">{cat?.icon || '📁'}</span>
                      <span className="font-medium">{category}</span>
                      <Badge variant="secondary">{categoryFiles.length}</Badge>
                    </div>
                    
                    <div className="pl-8 space-y-3">
                      {Object.entries(bySubFolder).map(([subFolder, subFiles]) => (
                        <div key={subFolder} className="space-y-1">
                          {subFolder !== '_root' && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>📂</span>
                              <span>{subFolder}</span>
                              <Badge variant="outline" className="text-xs">
                                {t('organize.nSimilar', { n: subFiles.length })}
                              </Badge>
                            </div>
                          )}
                          <div className={`space-y-1 max-h-48 overflow-y-auto ${subFolder !== '_root' ? 'pl-6' : ''}`}>
                            {subFiles.map((file) => {
                              const dest = [file.category, subFolder !== '_root' ? subFolder : null, file.name]
                                .filter(Boolean)
                                .join('/')
                              return (
                                <div
                                  key={file.path}
                                  className={`flex flex-wrap items-center gap-2 p-2 rounded bg-muted/50 text-sm ${
                                    file.skip ? 'opacity-60' : ''
                                  }`}
                                >
                                  <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(file.skip)}
                                      onChange={(e) => setFileSkip(file.path, e.target.checked)}
                                      className="h-4 w-4 rounded border border-input"
                                      aria-label={t('organize.skipThisRun')}
                                    />
                                    <span className="sr-only">{t('organize.skipThisRun')}</span>
                                  </label>
                                  <div className="min-w-0 flex-1 basis-[12rem]">
                                    <span className="truncate block max-w-md">{file.name}</span>
                                    <span className="text-xs text-muted-foreground truncate block max-w-md">
                                      → {dest}
                                    </span>
                                  </div>
                                  <div className="w-[min(100%,10rem)] sm:w-40 shrink-0">
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
                                  <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-auto">
                                    <span>{formatFileSize(file.size)}</span>
                                    <Badge
                                      variant={file.method === 'ai' ? 'default' : 'outline'}
                                      className="text-xs"
                                    >
                                      {methodLabel(file.method)}
                                    </Badge>
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
