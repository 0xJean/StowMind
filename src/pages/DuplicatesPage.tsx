import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import { DuplicateGroup, useAppStore } from '@/stores/app'
import { open } from '@tauri-apps/api/dialog'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { open as openPath } from '@tauri-apps/api/shell'
import { FolderOpen, Loader2, ScanSearch } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'

interface DuplicateScanProgress {
  current: number
  total: number
}

export function DuplicatesPage() {
  const { t } = useI18n()
  const [directory, setDirectory] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [progress, setProgress] = useState<DuplicateScanProgress | null>(null)

  const excludePatterns = useAppStore((s) => s.excludePatterns)

  useEffect(() => {
    const unlisten = listen<DuplicateScanProgress>('duplicate-scan-progress', (e) => {
      setProgress(e.payload)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const selectDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('duplicates.dialogTitle'),
    })
    if (selected && typeof selected === 'string') {
      setDirectory(selected)
    }
  }

  const runScan = useCallback(async () => {
    if (!directory.trim()) {
      toast.info(t('duplicates.needDir'))
      return
    }
    setScanning(true)
    setProgress(null)
    setGroups([])
    try {
      const result = await invoke<DuplicateGroup[]>('find_duplicates_cmd', {
        directory: directory.trim(),
        recursive,
        exclude_patterns: excludePatterns,
      })
      setGroups(result)
      if (result.length === 0) {
        toast.success(t('duplicates.noneFound'))
      } else {
        toast.success(t('duplicates.foundGroups', { n: result.length }))
      }
    } catch (e) {
      console.error(e)
      toast.error(t('duplicates.failScan', { error: String(e) }))
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }, [directory, recursive, excludePatterns, t])

  const reveal = (path: string) => {
    void openPath(path).catch(() => toast.error(t('duplicates.openFail')))
  }

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">{t('duplicates.title')}</h1>
        <p className="text-muted-foreground">{t('duplicates.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('duplicates.scanCard')}</CardTitle>
          <CardDescription>{t('duplicates.scanDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder={t('duplicates.inputPlaceholder')}
              className="font-mono text-sm"
            />
            <Button type="button" variant="secondary" onClick={() => void selectDirectory()}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {t('duplicates.browse')}
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
            <div>
              <div className="text-sm font-medium">{t('duplicates.recursive')}</div>
              <div className="text-xs text-muted-foreground">{t('duplicates.recursiveHint')}</div>
            </div>
            <Switch checked={recursive} onCheckedChange={setRecursive} />
          </div>
          <p className="text-xs text-muted-foreground">{t('duplicates.excludeHint')}</p>
          <Button onClick={() => void runScan()} disabled={scanning}>
            {scanning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('duplicates.scanning')}
              </>
            ) : (
              <>
                <ScanSearch className="w-4 h-4 mr-2" />
                {t('duplicates.scan')}
              </>
            )}
          </Button>
          {scanning && progress && progress.total > 0 && (
            <div className="space-y-2">
              <div className="text-muted-foreground text-sm">
                {t('duplicates.hashProgress', { cur: progress.current, total: progress.total })}
              </div>
              <Progress value={pct} />
            </div>
          )}
        </CardContent>
      </Card>

      {groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('duplicates.resultsTitle')}</CardTitle>
            <CardDescription>{t('duplicates.resultsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {groups.map((g, i) => (
              <div key={`${g.hash}-${i}`} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary">{formatFileSize(g.size)}</Badge>
                  <span className="text-xs font-mono text-muted-foreground break-all">{g.hash}</span>
                  <Badge>{t('duplicates.nCopies', { n: g.paths.length })}</Badge>
                </div>
                <ul className="space-y-1 text-sm">
                  {g.paths.map((p) => (
                    <li key={p} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs break-all flex-1 min-w-0">{p}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => reveal(p)}>
                        {t('duplicates.reveal')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
