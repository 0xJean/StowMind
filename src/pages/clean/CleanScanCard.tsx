import { ScanAtlasVisual, type ScanAtlasVisualState } from '@/components/ScanAtlasVisual'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { cn, formatFileSize } from '@/lib/utils'
import { AlertCircle, Ban, RefreshCw, Trash2 } from 'lucide-react'
import {
  getCleanFailureDetails,
  getCleanFailureKind,
  getCleanFailureSummary,
} from './cleanFailureHints'
import { findLatestProgress, findLatestStep, parseCleanProgress } from './cleanProgress'
import { CleanScanStatusPanel, formatElapsed } from './CleanScanStatusPanel'

interface CleanScanCardProps {
  preview: {
    potential_space: number
    item_count: number
  } | null
  loading: boolean
  scanIdle: boolean
  scanError: string | null
  scanElapsedMs: number
  scanIdleMs: number
  scanOutput: string[]
  activity?: 'scan' | 'clean'
  fullScreen?: boolean
  onScan: () => void
  onClean: () => void
  onCancel?: () => void
  cancelling?: boolean
}

export function CleanScanCard({
  preview,
  loading,
  scanIdle,
  scanError,
  scanElapsedMs,
  scanIdleMs,
  scanOutput,
  activity = 'scan',
  fullScreen = false,
  onScan,
  onClean,
  onCancel,
  cancelling = false,
}: CleanScanCardProps) {
  const { t } = useI18n()
  const cleaning = activity === 'clean'
  const progress = findLatestProgress(scanOutput)
  const stepLine = findLatestStep(scanOutput)
  const hasRealProgress = Boolean(progress) || Boolean(stepLine)
  const warming = loading && !hasRealProgress
  const showIdle = scanIdle && !warming
  const immersive = loading || (!preview && !scanError)

  // When cleaning with a known preview, estimate freed/remaining size by item ratio.
  const ratioKnown = Boolean(progress && progress.total !== null && progress.total > 0)
  const estimatedFreed =
    cleaning && preview && progress && ratioKnown && progress.phase === 'execution'
      ? Math.round((progress.current / (progress.total as number)) * preview.potential_space)
      : null
  const estimatedRemaining =
    cleaning && preview && estimatedFreed !== null
      ? Math.max(0, preview.potential_space - estimatedFreed)
      : null
  const failureKind = scanError ? getCleanFailureKind(scanError) : null
  const failureSummary = scanError
    ? failureKind?.kind === 'runtime_limit'
      ? t(cleaning ? 'clean.cleanRuntimeLimit' : 'clean.scanRuntimeLimit', {
          time: formatElapsed((failureKind.seconds ?? 0) * 1000),
        })
      : failureKind?.kind === 'idle_limit'
        ? t(cleaning ? 'clean.cleanIdleFailure' : 'clean.scanIdleFailure', {
            time: formatElapsed((failureKind.seconds ?? 0) * 1000),
          })
        : failureKind?.kind === 'permission'
          ? t('clean.diskAccessFailureHint')
          : getCleanFailureSummary(scanError)
    : ''
  const failureDetails = scanError ? getCleanFailureDetails(scanError) : ''

  return (
    <Card className={fullScreen ? 'w-full border-0 bg-transparent shadow-none' : undefined}>
      <CardContent className={`flex flex-col items-center justify-center gap-5 p-8 text-center ${
        fullScreen ? 'min-h-[calc(100vh-4rem)]' : immersive ? 'min-h-[34rem]' : 'min-h-[18rem]'
      }`}>
        <ScanAtlasVisual state={getCleanVisualState({ loading, scanIdle: showIdle, scanError, complete: Boolean(preview && !loading) })} />

        <div className="space-y-2">
          <CardTitle className={immersive ? 'text-3xl' : undefined}>
            {loading
              ? cleaning
                ? warming ? t('clean.cleanWarmingTitle') : showIdle ? t('clean.cleanIdleTitle') : t('clean.cleanRunningTitle')
                : warming ? t('clean.scanWarmingTitle') : showIdle ? t('clean.scanIdleTitle') : t('clean.scanRunningTitle')
              : scanError ? cleaning ? t('clean.cleanStatus.failed') : t('clean.scanFailedTitle') : preview ? formatFileSize(preview.potential_space) : t('clean.placeholderTitle')}
          </CardTitle>
          <CardDescription className="mx-auto max-w-xl">
            {loading
              ? warming
                ? t(cleaning ? 'clean.cleanWarmingDesc' : 'clean.scanWarmingDesc', {
                    time: formatElapsed(scanElapsedMs),
                  })
                : showIdle
                  ? t(cleaning ? 'clean.cleanIdleDesc' : 'clean.scanIdleDesc', {
                      time: formatElapsed(scanElapsedMs),
                      idle: formatElapsed(scanIdleMs),
                    })
                  : t(cleaning ? 'clean.cleanRunningDesc' : 'clean.scanRunningDesc', { time: formatElapsed(scanElapsedMs) })
              : scanError ? cleaning ? t('clean.cleanFailedDesc') : t('clean.scanFailedDesc') : preview
                ? t('clean.executionLatest', {
                    count: preview.item_count,
                    size: formatFileSize(preview.potential_space),
                  })
                : t('clean.placeholderDesc')}
          </CardDescription>
        </div>

        {!loading && scanError && (
          <div className="w-full max-w-2xl rounded-2xl border border-iqon-red/30 bg-iqon-red/5 p-4 text-left">
            <div className="flex items-center gap-2 text-xs font-bold text-iqon-red">
              <AlertCircle className="h-4 w-4" />
              {t('clean.scanFailureTitle')}
            </div>
            <p className="mt-2 break-words font-mono text-xs leading-relaxed text-foreground">
              {failureSummary}
            </p>
            {failureDetails && (
              <details className="mt-3 rounded-xl border border-iqon-red/20 bg-background/40 p-3">
                <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
                  {t('clean.scanFailureDetails')}
                </summary>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {failureDetails}
                </pre>
              </details>
            )}
          </div>
        )}

        {loading && (
          <ProgressTracker
            tone={showIdle ? 'yellow' : 'green'}
            progress={progress}
            stepLine={stepLine}
            warming={warming}
            cleaning={cleaning}
            scanIdle={showIdle}
            estimatedFreed={estimatedFreed}
            estimatedRemaining={estimatedRemaining}
            t={t}
          />
        )}

        {!loading && !preview && !scanError && (
          <Button type="button" className="mt-1 w-full max-w-xs" onClick={onScan}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t('clean.preview')}
          </Button>
        )}
        {!loading && scanError && (
          <Button type="button" className="mt-1 w-full max-w-xs" onClick={onScan}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('clean.scanRetry')}
          </Button>
        )}
        {loading && onCancel && (
          <Button
            type="button"
            variant="outline"
            className="mt-1 w-full max-w-xs border-iqon-yellow/40 text-iqon-yellow hover:bg-iqon-yellow/10"
            onClick={onCancel}
            disabled={cancelling}
          >
            <Ban className="mr-2 h-4 w-4" />
            {cancelling ? t('clean.cancelling') : t(cleaning ? 'clean.cancelClean' : 'clean.cancelScan')}
          </Button>
        )}
        {!loading && preview && (
          <Button type="button" className="mt-1 w-full max-w-xs" onClick={onClean}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t('clean.cleanableAction', { size: formatFileSize(preview.potential_space) })}
          </Button>
        )}

        {(loading || scanOutput.length > 0 || scanError) && (
          <CleanScanStatusPanel
            loading={loading}
            scanIdle={showIdle}
            scanError={scanError}
            scanElapsedMs={scanElapsedMs}
            scanOutput={scanOutput}
            activity={activity}
          />
        )}
      </CardContent>
    </Card>
  )
}

function ProgressTracker({
  tone,
  progress,
  stepLine,
  warming,
  cleaning,
  scanIdle,
  estimatedFreed,
  estimatedRemaining,
  t,
}: {
  tone: 'green' | 'yellow'
  progress: ReturnType<typeof parseCleanProgress>
  stepLine: string | null
  warming: boolean
  cleaning: boolean
  scanIdle: boolean
  estimatedFreed: number | null
  estimatedRemaining: number | null
  t: ReturnType<typeof useI18n>['t']
}) {
  const barColor = tone === 'yellow' ? 'bg-iqon-yellow' : 'bg-iqon-green'
  const hasRatio = Boolean(progress && progress.total !== null)
  const phase = progress?.phase ?? 'unknown'
  const isDiscovery = phase === 'discovery' && !hasRatio
  const indeterminate = !hasRatio
  const percent = progress?.percent ?? 0
  const remaining =
    progress && progress.total !== null ? Math.max(0, progress.total - progress.current) : null

  // Phase-aware primary label
  const primaryLabel = warming
    ? t('clean.progress.warming')
    : isDiscovery
      ? t('clean.progress.discovering')
      : cleaning
        ? t('clean.progress.cleaning')
        : t('clean.progress.scanning')

  // Right-side label: percentage > raw count > idle/warming placeholder
  const rightLabel = hasRatio
    ? `${percent}%`
    : progress
      ? isDiscovery
        ? t('clean.progress.discoveredCount', { n: progress.current })
        : String(progress.current)
      : warming
        ? '—'
        : scanIdle
          ? t('clean.progress.idle')
          : '—'

  return (
    <div className="w-full max-w-2xl space-y-3 text-left">
      <div className="iqon-row p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-bold">
            <span className={cn('iqon-dot', tone === 'yellow' ? 'iqon-dot-yellow' : 'iqon-dot-green')} />
            <span className="shrink-0 text-foreground">{primaryLabel}</span>
            {!warming && !isDiscovery && stepLine && (
              <span className="truncate font-mono text-[10px] font-normal text-muted-foreground">
                · {stepLine}
              </span>
            )}
          </div>
          <span
            className={cn(
              'shrink-0 font-mono text-xs font-bold tabular-nums',
              scanIdle && !hasRatio ? 'text-iqon-yellow' : isDiscovery ? 'text-iqon-cyan' : 'text-foreground'
            )}
          >
            {rightLabel}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-iqon-border">
          {indeterminate ? (
            <div className={cn('stow-indeterminate-bar h-full w-1/3 rounded-full', barColor)} />
          ) : (
            <div
              className={cn('h-full rounded-full transition-all duration-300', barColor)}
              style={{ width: `${percent}%` }}
            />
          )}
        </div>
        {hasRatio && progress && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{t('clean.progress.itemsTotal', { current: progress.current, total: progress.total ?? 0 })}</span>
            {remaining !== null && remaining > 0 && (
              <span>{t('clean.progress.itemsRemaining', { n: remaining })}</span>
            )}
          </div>
        )}
        {!hasRatio && progress && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isDiscovery ? t('clean.progress.discoveryHint') : t('clean.progress.itemsCount', { n: progress.current })}
          </p>
        )}
        {hasRatio && cleaning && estimatedFreed !== null && estimatedRemaining !== null && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-iqon-border pt-2 text-[10px]">
            <div>
              <p className="iqon-eyebrow">{t('clean.progress.estFreedLabel')}</p>
              <p className="mt-0.5 font-mono text-xs font-bold tabular-nums text-iqon-green">
                {formatFileSize(estimatedFreed)}
              </p>
            </div>
            <div>
              <p className="iqon-eyebrow">{t('clean.progress.estRemainingLabel')}</p>
              <p className="mt-0.5 font-mono text-xs font-bold tabular-nums text-muted-foreground">
                {formatFileSize(estimatedRemaining)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function getCleanVisualState({
  loading,
  scanIdle,
  scanError,
  complete,
}: {
  loading: boolean
  scanIdle: boolean
  scanError: string | null
  complete: boolean
}): ScanAtlasVisualState {
  if (loading) return scanIdle ? 'idle' : 'loading'
  if (scanError) return 'error'
  if (complete) return 'complete'
  return 'ready'
}
