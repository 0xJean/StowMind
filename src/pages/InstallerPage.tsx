import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { deleteResultSnapshot, loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { formatFileSize } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { open as openPath } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import { Archive, CheckCircle2, Database, ExternalLink, FolderDown, Loader2, Package, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'react-toastify'
import { MaintenanceScanCard, formatMaintenanceElapsed } from './maintenance/MaintenanceScanCard'
import { useMaintenanceScanProgress } from './maintenance/useMaintenanceScanProgress'

interface MoleInstallerItem {
  path: string
  name: string
  size: number
  source: string
}

interface MoleInstallerPreview {
  items: MoleInstallerItem[]
  total_size: number
}

interface MoleInstallerExecuteOutcome {
  item_count: number
  total_size: number
  raw_output: string
}

export function InstallerPage() {
  const { t } = useI18n()
  const [preview, setPreview] = useState<MoleInstallerPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const scanElapsedMs = useMaintenanceScanProgress(loading)
  const addHistory = useAppStore((s) => s.addHistory)
  const statistics = useAppStore((s) => s.statistics)
  const updateStatistics = useAppStore((s) => s.updateStatistics)

  const items = useMemo(
    () => [...(preview?.items ?? [])].sort((a, b) => b.size - a.size),
    [preview]
  )

  const runPreview = async () => {
    setLoading(true)
    setScanError(null)
    try {
      const next = await invoke<MoleInstallerPreview>('mole_installer_preview')
      setPreview(next)
      await saveResultSnapshot(resultCacheKeys.installerPreview, next)
      addHistory(createCleanupHistoryRecord({
        type: 'installer',
        target: t('installer.title'),
        label: t('history.type.installer'),
        itemCount: next.items.length,
        totalSize: next.total_size,
        action: 'preview',
        executed: false,
      }))
      if (next.items.length === 0) {
        toast.success(t('installer.noneFound'))
      }
    } catch (err) {
      const message = String(err)
      setScanError(t('installer.fail', { error: message }))
      toast.error(t('installer.fail', { error: message }))
    } finally {
      setLoading(false)
    }
  }

  const reveal = (path: string) => {
    void openPath(path).catch(() => toast.error(t('installer.openFail')))
  }

  const executeWithMole = async () => {
    if (!preview || preview.items.length === 0) return

    const confirmed = window.confirm(
      t('installer.executeConfirm', {
        count: preview.items.length,
        size: formatFileSize(preview.total_size),
      })
    )
    if (!confirmed) return

    setExecuting(true)
    try {
      const outcome = await invoke<MoleInstallerExecuteOutcome>('mole_installer_execute', {
        paths: preview.items.map((item) => item.path),
      })
      const itemCount = outcome.item_count || preview.items.length
      const totalSize = outcome.total_size || preview.total_size
      const timestamp = new Date().toISOString()

      if (itemCount > 0) {
        addHistory(createCleanupHistoryRecord({
          type: 'installer',
          target: t('installer.title'),
          label: t('history.type.installer'),
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
      await deleteResultSnapshot(resultCacheKeys.installerPreview)
      toast.success(t('installer.executeSuccess', { count: itemCount }))
    } catch (err) {
      toast.error(t('installer.executeFail', { error: String(err) }))
    } finally {
      setExecuting(false)
    }
  }

  useEffect(() => {
    void (async () => {
      const snapshot = await loadResultSnapshot<MoleInstallerPreview>(resultCacheKeys.installerPreview)
      if (snapshot) {
        setPreview(snapshot.payload)
        setScanError(null)
      }
    })()
  }, [])

  const installerScanScope = (
    <div className="iqon-row p-4 text-left">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-iqon-border bg-background/50 text-iqon-green">
          <FolderDown className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{t('installer.scopeTitle')}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('installer.scopeDesc')}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <InstallerScopeChip icon={<ShieldCheck className="h-3.5 w-3.5" />} label={t('installer.scanPreviewOnly')} />
        <InstallerScopeChip icon={<Database className="h-3.5 w-3.5" />} label={t('installer.scanCommonPaths')} />
        <InstallerScopeChip icon={<CheckCircle2 className="h-3.5 w-3.5" />} label={t('installer.scanConfirmLater')} />
      </div>
    </div>
  )

  const emptyPreview = Boolean(preview && items.length === 0)
  const fullscreenScan = !preview || loading || emptyPreview

  if (fullscreenScan) {
    return (
      <div className="stow-clean-fullscreen">
        <MaintenanceScanCard
          fullScreen
          actionIcon={Archive}
          actionLabel={emptyPreview ? t('installer.scanAgain') : t('installer.preview')}
          description={emptyPreview ? t('installer.emptyDesc') : t('installer.scanIdleDesc')}
          elapsedLabel={t('clean.scanElapsed', { time: formatMaintenanceElapsed(scanElapsedMs) })}
          errorMessage={scanError}
          idleStatus={emptyPreview ? t('installer.noneFound') : t('installer.scanReadyStatus')}
          loading={loading}
          loadingDescription={t('installer.scanRunningDesc', {
            time: formatMaintenanceElapsed(scanElapsedMs),
          })}
          loadingStatus={t('installer.scanRunningStatus')}
          loadingTitle={t('installer.scanRunningTitle')}
          onAction={() => void runPreview()}
          title={scanError ? t('installer.scanFailedTitle') : emptyPreview ? t('installer.noneFound') : t('installer.scanIdleTitle')}
        >
          {installerScanScope}
        </MaintenanceScanCard>
      </div>
    )
  }

  return (
    <div className="stow-page">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('installer.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('installer.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void runPreview()}>
            <Archive className="w-4 h-4 mr-2" />
            {t('installer.preview')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="stow-metric-card">
          <p className="text-sm text-muted-foreground">{t('installer.scopeTitle')}</p>
          <p className="mt-2 text-2xl font-bold">{t('installer.scopeValue')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('installer.scopeDesc')}</p>
        </div>
        <div className="stow-metric-card">
          <p className="text-sm text-muted-foreground">{t('clean.itemCount')}</p>
          <p className="mt-2 text-2xl font-bold">{items.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('installer.resultsTitle')}</p>
        </div>
        <div className="stow-metric-card">
          <p className="text-sm text-muted-foreground">{t('clean.potentialSpace')}</p>
          <p className="mt-2 text-2xl font-bold">{formatFileSize(preview?.total_size ?? 0)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('installer.emptyDesc')}</p>
        </div>
      </div>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>{t('installer.resultsTitle')}</CardTitle>
            <CardDescription>
              {items.length > 0
                ? t('installer.resultsDesc', {
                    count: items.length,
                    size: formatFileSize(preview.total_size),
                  })
                : t('installer.emptyDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.length > 0 && (
              <Button type="button" variant="destructive" onClick={() => void executeWithMole()} disabled={executing}>
                {executing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                {t('installer.executeMole', { count: items.length })}
              </Button>
            )}
            {items.map((item) => (
              <div key={item.path} className="stow-list-row flex items-start gap-3">
                <div className="stow-icon-box">
                  <Package className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold break-words">{item.name}</p>
                    {item.source && <Badge variant="secondary">{item.source}</Badge>}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground break-all">{item.path}</p>
                </div>
                <span className="text-sm font-bold shrink-0">{formatFileSize(item.size)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => reveal(item.path)}>
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground flex items-start gap-3">
              <Archive className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{t('installer.executeHint')}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function InstallerScopeChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-iqon-border bg-background/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
      <span className="shrink-0 text-iqon-green">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}
