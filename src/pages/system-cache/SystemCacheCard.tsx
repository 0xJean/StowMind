import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn, formatDate, formatFileSize } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, HardDrive, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useId } from 'react'
import { CleanInteractionPrompt } from '../clean/CleanInteractionPrompt'
import { hasMeasuredSize, measurementDeltaLabel, statusLabelKey } from './helpers'
import type { SystemCacheReport } from './types'
import type { SystemCacheController } from './useSystemCache'

interface SystemCacheCardProps {
  cache: SystemCacheController
  active: boolean
  shared?: boolean
  onClean?: () => void
}

export function SystemCacheCard({ cache, active, shared = false, onClean }: SystemCacheCardProps) {
  const { t } = useI18n()
  const headingId = useId()
  const { report, outcome, activity } = cache
  const busy = activity !== null

  return (
    <section className="iqon-card space-y-4 p-5" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="flex items-center gap-2 text-sm font-bold">
            <HardDrive className="h-4 w-4 text-iqon-cyan" />{t(shared ? 'systemCache.sharedTitle' : 'systemCache.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t(shared ? 'systemCache.sharedDescription' : 'systemCache.description')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void cache.scan()} disabled={busy}>
          <RefreshCw className={cn('mr-2 h-4 w-4', activity === 'scan' && 'animate-spin')} />
          {t('systemCache.scan')}
        </Button>
      </div>

      <div className="iqon-row space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">{t('systemCache.iconservices')}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {report?.path ?? '/Library/Caches/com.apple.iconservices.store'}
            </p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{sizeLabel(report, t)}</p>
        </div>
        {report && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn('iqon-pill', hasMeasuredSize(report) && !report.anomaly ? 'text-iqon-green' : 'text-iqon-yellow')}>
                {t(statusLabelKey(report))}
              </span>
              {report.authorized && <span className="flex items-center gap-1 text-iqon-green"><ShieldCheck className="h-3.5 w-3.5" />{t('systemCache.authorized')}</span>}
              <span className="text-muted-foreground">{t('systemCache.checkedAt', { time: formatDate(new Date(report.scanned_at * 1000).toISOString()) })}</span>
            </div>
            {report.message && <p className="break-words text-xs text-muted-foreground">{report.message}</p>}
            {report.modified_at !== null && <p className="text-[11px] text-muted-foreground">{t('systemCache.modifiedAt', { time: formatDate(new Date(report.modified_at * 1000).toISOString()) })}</p>}
            <p className="text-[11px] text-muted-foreground">{t('systemCache.threshold', { size: formatFileSize(report.threshold_bytes) })}</p>
            {!report.mole_supported && <p className="text-xs text-iqon-yellow">{t('systemCache.moleUnavailable')} {report.mole_message}</p>}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onClean ?? (() => void cache.review())} disabled={busy || report?.status === 'unsupported'}>
            <ShieldCheck className="mr-2 h-4 w-4" />{t('systemCache.review')}
          </Button>
        </div>
        {shared && <p className="text-xs font-semibold text-muted-foreground">{t('systemCache.sharedScopeHint')}</p>}
        <p className="text-[11px] text-muted-foreground">{t(shared ? 'systemCache.reviewHintTop' : 'systemCache.reviewHint')}</p>
      </div>

      {busy && activity && (
        <div className="rounded-xl border border-iqon-border bg-background/40 p-3" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs font-semibold"><Loader2 className="h-4 w-4 animate-spin" />{t(`systemCache.activity.${activity}`)}</p>
            {activity !== 'scan' && <Button type="button" variant="ghost" size="sm" onClick={() => void cache.cancel()} disabled={cache.cancelling}>
              <X className="mr-1 h-3.5 w-3.5" />{t(cache.cancelling ? 'systemCache.cancelling' : 'systemCache.cancel')}
            </Button>}
          </div>
          {cache.progress && <p className="mt-2 break-words text-[11px] text-muted-foreground">{cache.progress}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">{t('systemCache.largeDirectoryHint')}</p>
        </div>
      )}

      {cache.error && <div className="flex gap-2 rounded-xl border border-iqon-yellow/30 bg-iqon-yellow/5 p-3" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-iqon-yellow" />
        <p className="whitespace-pre-wrap break-words text-xs text-iqon-yellow">{cache.error}</p>
      </div>}

      {outcome && <div className={cn('rounded-xl border p-4', outcome.success ? 'border-iqon-green/30 bg-iqon-green/5' : 'border-iqon-yellow/30 bg-iqon-yellow/5')}>
        <h3 className="flex items-center gap-2 text-xs font-bold">
          {outcome.success ? <CheckCircle2 className="h-4 w-4 text-iqon-green" /> : <AlertTriangle className="h-4 w-4 text-iqon-yellow" />}
          {t(outcome.success ? 'systemCache.cleanCompleted' : 'systemCache.cleanIncomplete')}
        </h3>
        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
          <Measurement label={t('systemCache.before')} report={outcome.before} />
          <Measurement label={t('systemCache.after')} report={outcome.after} />
          <div><p className="text-muted-foreground">{t('systemCache.delta')}</p><p className="mt-1 font-semibold">{measurementDeltaLabel(outcome.measured_delta_bytes, t, formatFileSize)}</p></div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{t('systemCache.deltaHint')}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('systemCache.recorded')}</p>
      </div>}

      <CleanInteractionPrompt
        open={active && cache.interaction !== null}
        kind={cache.interaction?.kind ?? 'password'}
        prompt={cache.interaction?.prompt ?? ''}
        value={cache.input}
        submitting={cache.submitting}
        onChange={cache.setInput}
        onSubmit={(value) => void cache.submit(value)}
        onCancel={() => void cache.cancel()}
        cancelLabel={t('systemCache.cancel')}
      />
    </section>
  )
}

function sizeLabel(report: SystemCacheReport | null, t: ReturnType<typeof useI18n>['t']) {
  if (hasMeasuredSize(report)) return formatFileSize(report!.size_bytes!)
  if (report?.status === 'not_found') return t('systemCache.status.not_found')
  return t('systemCache.unknownSize')
}

function Measurement({ label, report }: { label: string; report: SystemCacheReport }) {
  const { t } = useI18n()
  return <div><p className="text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{sizeLabel(report, t)}</p><p className="mt-1 text-[10px] text-muted-foreground">{t(statusLabelKey(report))}</p></div>
}
