import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { formatFileSize, pathRoughlyEqual } from '@/lib/utils'
import { FileItem, FolderItem, MoveRecord, OrganizeOutcome, useAppStore } from '@/stores/app'
import { open } from '@tauri-apps/api/dialog'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { Brain, Folder, FolderOpen, Loader2, Play, RotateCcw, Scan } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  
  const aiProvider = useAppStore((s) => s.aiProvider)
  const categories = useAppStore((s) => s.categories)
  const aiOnlyHardCases = useAppStore((s) => s.aiOnlyHardCases)
  const addHistory = useAppStore((s) => s.addHistory)
  const updateStatistics = useAppStore((s) => s.updateStatistics)
  const statistics = useAppStore((s) => s.statistics)

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
        aiOnlyHardCases,
        aiProvider,
        categories,
        showTempFiles
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

  const organizeFiles = async () => {
    if (files.length === 0 && folders.length === 0) return

    const totalCount = files.length + folders.length
    const confirmed = window.confirm(t('organize.confirmMsg', { n: totalCount }))
    if (!confirmed) return
    
    setOrganizing(true)
    
    try {
      const allMoves: MoveRecord[] = []
      const allErrors: string[] = []

      if (files.length > 0) {
        const out = await invoke<OrganizeOutcome>('organize_files', {
          directory,
          files
        })
        allMoves.push(...out.moves)
        allErrors.push(...out.errors)
      }

      if (folders.length > 0) {
        const out = await invoke<OrganizeOutcome>('organize_folders', {
          directory,
          folders
        })
        allMoves.push(...out.moves)
        allErrors.push(...out.errors)
      }

      const okCount = allMoves.length
      const failCount = allErrors.length

      let sizeOk = 0
      const successesByCategory: Record<string, number> = {}
      for (const m of allMoves) {
        const fi = files.find((f) => pathRoughlyEqual(f.path, m.from))
        if (fi) {
          sizeOk += fi.size
          successesByCategory[fi.category] = (successesByCategory[fi.category] || 0) + 1
        }
        const fo = folders.find((f) => pathRoughlyEqual(f.path, m.from))
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

      if (okCount > 0 || failCount > 0) {
        addHistory({
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          directory,
          totalFiles: okCount,
          categories: successesByCategory,
          executed: true,
          moves: allMoves,
          organizeErrors: failCount > 0 ? allErrors : undefined
        })
      }

      if (failCount === 0 && okCount > 0) {
        setFiles([])
        setFolders([])
        setDirectory('')
        toast.success(t('organize.successMsg', { n: okCount }))
        setTimeout(() => navigate('/history'), 1500)
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
    }
  }

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

  return (
    <div
      className="p-6 space-y-6 relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => { setDragOver(false); handleDrop(e) }}
    >
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
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
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
            </div>
            
            <Button onClick={scanDirectory} disabled={!directory || scanning}>
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

      {(files.length > 0 || folders.length > 0) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {t('organize.resultTitle')} ({t('organize.nFiles', { n: files.length })}
              {folders.length > 0 ? `, ${t('organize.nFolders', { n: folders.length })}` : ''})
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setFiles([]); setFolders([]) }}>
                <RotateCcw className="w-4 h-4 mr-2" />
                {t('organize.reset')}
              </Button>
              <Button onClick={organizeFiles} disabled={organizing}>
                <Play className="w-4 h-4 mr-2" />
                {organizing ? t('organize.organizing') : t('organize.execute')}
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
                          {categoryFolders.map((folder, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                            >
                              <div className="flex items-center gap-2">
                                <Folder className="w-4 h-4 text-muted-foreground" />
                                <span className="truncate max-w-md">{folder.name}</span>
                              </div>
                              <div className="flex items-center gap-3 text-muted-foreground">
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
                            {subFiles.map((file, idx) => {
                              const dest = [category, subFolder !== '_root' ? subFolder : null, file.name].filter(Boolean).join('/')
                              return (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                                >
                                  <div className="min-w-0 flex-1 mr-3">
                                    <span className="truncate block max-w-md">{file.name}</span>
                                    <span className="text-xs text-muted-foreground truncate block max-w-md">→ {dest}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                                    <span>{formatFileSize(file.size)}</span>
                                    <Badge variant={file.method === 'ai' ? 'default' : 'outline'} className="text-xs">
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
