import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { FolderOpen, Loader2, ScanSearch } from 'lucide-react'
import { MaintenanceScanCard, formatMaintenanceElapsed } from '../maintenance/MaintenanceScanCard'
import type { DuplicateScanProgress } from './types'

interface DuplicatesScanCardProps {
  directory: string
  errorMessage: string | null
  elapsedMs: number
  emptyResult: boolean
  loading: boolean
  progress: DuplicateScanProgress | null
  recursive: boolean
  onBrowse: () => void
  onDirectoryChange: (directory: string) => void
  onRecursiveChange: (recursive: boolean) => void
  onScan: () => void
}

export function DuplicatesScanCard({
  directory,
  errorMessage,
  elapsedMs,
  emptyResult,
  loading,
  progress,
  recursive,
  onBrowse,
  onDirectoryChange,
  onRecursiveChange,
  onScan,
}: DuplicatesScanCardProps) {
  const { t } = useI18n()
  const progressPercent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0
  const progressLabel = getProgressLabel(progress, t)
  const title = errorMessage
    ? t('duplicates.scanFailedTitle')
    : emptyResult
      ? t('duplicates.noneFound')
      : t('duplicates.scanIdleTitle')
  const description = emptyResult ? t('duplicates.noneFoundDesc') : t('duplicates.scanDesc')

  return (
    <MaintenanceScanCard
      fullScreen
      actionDisabled={!directory.trim()}
      actionIcon={ScanSearch}
      actionLabel={emptyResult ? t('duplicates.scanAgain') : t('duplicates.scan')}
      description={description}
      elapsedLabel={t('clean.scanElapsed', { time: formatMaintenanceElapsed(elapsedMs) })}
      errorMessage={errorMessage}
      idleStatus={emptyResult ? t('duplicates.noneFound') : t('duplicates.scanReadyStatus')}
      loading={loading}
      loadingDescription={t('duplicates.scanningDesc', { time: formatMaintenanceElapsed(elapsedMs) })}
      loadingStatus={progressLabel}
      loadingTitle={t('duplicates.scanningTitle')}
      onAction={onScan}
      title={title}
    >
      <div className="space-y-3">
        <div className="rounded-2xl border border-iqon-border bg-surface-hover/60 p-4 text-left">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={directory}
              onChange={(event) => onDirectoryChange(event.target.value)}
              placeholder={t('duplicates.inputPlaceholder')}
              className="font-mono text-sm"
              disabled={loading}
            />
            <Button type="button" variant="secondary" onClick={onBrowse} className="sm:w-auto" disabled={loading}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('duplicates.browse')}
            </Button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-iqon-border bg-iqon-row px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground">{t('duplicates.recursive')}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{t('duplicates.recursiveHint')}</p>
            </div>
            <Switch
              checked={recursive}
              onCheckedChange={onRecursiveChange}
              disabled={loading}
              aria-label={t('duplicates.recursive')}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('duplicates.excludeHint')}</p>
        </div>

        {loading && (
          <div className="iqon-row p-4 text-left">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-foreground">
                <span className="iqon-dot iqon-dot-cyan" />
                <span className="truncate">{progressLabel}</span>
              </span>
              {progress && progress.total > 0 ? (
                <span className="font-mono text-xs font-bold tabular-nums">{progressPercent}%</span>
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-iqon-cyan" />
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-iqon-border">
              {progress && progress.total > 0 ? (
                <div
                  className="h-full rounded-full bg-iqon-cyan transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              ) : (
                <div className="stow-indeterminate-bar h-full w-1/3 rounded-full bg-iqon-cyan" />
              )}
            </div>
          </div>
        )}

        <div className="iqon-pill mx-auto w-fit">
          <span className="iqon-dot iqon-dot-green" />
          <span className="text-[10px] text-muted-foreground">{t('duplicates.safeNote')}</span>
        </div>
      </div>
    </MaintenanceScanCard>
  )
}

function getProgressLabel(
  progress: DuplicateScanProgress | null,
  t: ReturnType<typeof useI18n>['t']
) {
  if (!progress) return t('duplicates.collecting')
  if (progress.phase === 'collecting') {
    return progress.total > 0
      ? t('duplicates.collectProgress', { cur: progress.current })
      : t('duplicates.collecting')
  }
  if (progress.phase === 'finalizing') return t('duplicates.finalizing')
  return t('duplicates.hashProgress', { cur: progress.current, total: progress.total })
}
