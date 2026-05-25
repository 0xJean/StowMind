import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { deleteResultSnapshot, loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { formatFileSize } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { open } from '@tauri-apps/api/dialog'
import { open as openPath } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import { FolderOpen, Loader2, PackageX, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { MaintenanceScanCard, formatMaintenanceElapsed } from './maintenance/MaintenanceScanCard'
import { useMaintenanceScanProgress } from './maintenance/useMaintenanceScanProgress'

interface MolePurgeItem {
  path: string
  size: number
}

interface MolePurgePreview {
  root: string
  items: MolePurgeItem[]
  total_size: number
}

interface MoleExecuteOutcome {
  item_count: number
  total_size: number
  raw_output: string
}

export function PurgePage() {
  const { t } = useI18n()
  const [directory, setDirectory] = useState('')
  const [preview, setPreview] = useState<MolePurgePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const scanElapsedMs = useMaintenanceScanProgress(loading)
  const addHistory = useAppStore((s) => s.addHistory)
  const statistics = useAppStore((s) => s.statistics)
  const updateStatistics = useAppStore((s) => s.updateStatistics)

  const selectDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('purge.dialogTitle'),
    })
    if (selected && typeof selected === 'string') {
      setDirectory(selected)
      setScanError(null)
      await loadCachedPreview(selected)
    }
  }

  const loadCachedPreview = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) {
      setPreview(null)
      return
    }
    const snapshot = await loadResultSnapshot<MolePurgePreview>(resultCacheKeys.purgePreview(trimmed))
    setPreview(snapshot?.payload ?? null)
  }

  const runPreview = async () => {
    if (!directory.trim()) {
      toast.info(t('purge.needDir'))
      return
    }

    setLoading(true)
    setScanError(null)
    try {
      const next = await invoke<MolePurgePreview>('mole_purge_preview', {
        path: directory.trim(),
      })
      setPreview(next)
      await saveResultSnapshot(resultCacheKeys.purgePreview(directory.trim()), next)
      addHistory(createCleanupHistoryRecord({
        type: 'purge',
        target: next.root || directory.trim(),
        label: t('history.type.purge'),
        itemCount: next.items.length,
        totalSize: next.total_size,
        action: 'preview',
        executed: false,
      }))
      if (next.items.length === 0) {
        toast.success(t('purge.noneFound'))
      }
    } catch (err) {
      const message = String(err)
      setScanError(t('purge.fail', { error: message }))
      toast.error(t('purge.fail', { error: message }))
    } finally {
      setLoading(false)
    }
  }

  const reveal = (path: string) => {
    void openPath(path).catch(() => toast.error(t('purge.openFail')))
  }

  const executeWithMole = async () => {
    if (!preview || preview.items.length === 0) return

    const confirmed = window.confirm(
      t('purge.executeConfirm', {
        count: preview.items.length,
        size: formatFileSize(preview.total_size),
      })
    )
    if (!confirmed) return

    setExecuting(true)
    try {
      const outcome = await invoke<MoleExecuteOutcome>('mole_purge_execute', {
        path: preview.root,
      })
      const itemCount = outcome.item_count || preview.items.length
      const totalSize = outcome.total_size || preview.total_size
      const timestamp = new Date().toISOString()

      if (itemCount > 0) {
        addHistory(createCleanupHistoryRecord({
          type: 'purge',
          target: preview.root,
          label: t('history.type.purge'),
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

      setPreview(null)
      await deleteResultSnapshot(resultCacheKeys.purgePreview(preview.root))
      toast.success(t('purge.executeSuccess', { count: itemCount }))
    } catch (err) {
      toast.error(t('purge.executeFail', { error: String(err) }))
    } finally {
      setExecuting(false)
    }
  }

  useEffect(() => {
    void loadCachedPreview(directory)
  }, [directory])

  const scanControls = (
    <div className="rounded-2xl border bg-surface-hover/60 p-4 text-left">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={directory}
          onChange={(e) => {
            setDirectory(e.target.value)
            setScanError(null)
          }}
          placeholder={t('purge.inputPlaceholder')}
          className="font-mono text-sm"
          disabled={loading}
        />
        <Button type="button" variant="secondary" onClick={() => void selectDirectory()} className="sm:w-auto" disabled={loading}>
          <FolderOpen className="w-4 h-4 mr-2" />
          {t('purge.browse')}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('purge.scanScopeHint')}</p>
    </div>
  )

  const fullscreenScan = !preview || loading

  if (fullscreenScan) {
    return (
      <div className="stow-clean-fullscreen">
        <MaintenanceScanCard
          fullScreen
          actionDisabled={!directory.trim()}
          actionIcon={PackageX}
          actionLabel={t('purge.preview')}
          description={t('purge.scanIdleDesc')}
          elapsedLabel={t('clean.scanElapsed', { time: formatMaintenanceElapsed(scanElapsedMs) })}
          errorMessage={scanError}
          idleStatus={t('purge.scanReadyStatus')}
          loading={loading}
          loadingDescription={t('purge.scanRunningDesc', {
            path: directory.trim() || t('purge.scanPathFallback'),
            time: formatMaintenanceElapsed(scanElapsedMs),
          })}
          loadingStatus={t('purge.scanRunningStatus')}
          loadingTitle={t('purge.scanRunningTitle')}
          onAction={() => void runPreview()}
          title={scanError ? t('purge.scanFailedTitle') : t('purge.scanIdleTitle')}
        >
          {scanControls}
        </MaintenanceScanCard>
      </div>
    )
  }

  return (
    <div className="stow-page">
      <div>
        <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('purge.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('purge.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('purge.previewCard')}</CardTitle>
          <CardDescription>{t('purge.previewDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanControls}
          <Button onClick={() => void runPreview()} disabled={!directory.trim()}>
            <PackageX className="w-4 h-4 mr-2" />
            {t('purge.preview')}
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>{t('purge.resultsTitle')}</CardTitle>
            <CardDescription>
              {preview.items.length > 0
                ? t('purge.resultsDesc', {
                    count: preview.items.length,
                    size: formatFileSize(preview.total_size),
                  })
                : t('purge.emptyDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.items.length > 0 && (
              <Button type="button" variant="destructive" onClick={() => void executeWithMole()} disabled={executing}>
                {executing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                {t('purge.executeMole', { count: preview.items.length })}
              </Button>
            )}
            {preview.items.map((item) => (
              <div key={item.path} className="flex items-center gap-3 rounded-2xl border p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs break-all">{item.path}</p>
                </div>
                <span className="text-sm font-medium shrink-0">{formatFileSize(item.size)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => reveal(item.path)}>
                  {t('purge.open')}
                </Button>
              </div>
            ))}
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground flex items-start gap-3">
              <Terminal className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{t('purge.executeHint')}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
