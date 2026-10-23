import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { HistoryRecord } from '@/stores/app'
import { Loader2, Trash2, Undo2 } from 'lucide-react'
import { SystemCacheHistoryDetail } from './SystemCacheHistoryDetail'
import { cleanupHistoryCountLabel, cleanupHistoryOperationLabels, cleanupHistoryProcessedLabel, cleanupHistorySizeLabel } from './cleanupLabels'
import { HISTORY_ICONS, HISTORY_TYPE_KEYS } from './historyPresentation'

type TimelineTone = 'green' | 'cyan' | 'red' | 'yellow' | 'muted'

const TONE_RING: Record<TimelineTone, string> = {
  green: 'bg-iqon-green/10 border-iqon-green/30 text-iqon-green',
  cyan: 'bg-iqon-cyan/10 border-iqon-cyan/30 text-iqon-cyan',
  red: 'bg-iqon-red/10 border-iqon-red/30 text-iqon-red',
  yellow: 'bg-iqon-yellow/10 border-iqon-yellow/30 text-iqon-yellow',
  muted: 'bg-iqon-card border-iqon-border text-foreground',
}

function recordTone(record: HistoryRecord): TimelineTone {
  if (record.undone) return 'muted'
  const type = record.type ?? 'organize'
  if (record.cleanupSummary?.outcome === 'failed') return 'red'
  if (['partial', 'unknown', 'skipped'].includes(record.cleanupSummary?.outcome ?? '')) return 'yellow'
  if (!record.executed) return 'yellow'
  if (type === 'clean' || type === 'purge' || type === 'uninstall' || type === 'agent-cleanup') return 'red'
  if (type === 'optimize') return 'green'
  if (type === 'duplicates') return 'cyan'
  return 'green'
}

export function TimelineItem({
  record,
  isLast,
  undoing,
  onUndo,
  onRemove,
}: {
  record: HistoryRecord
  isLast: boolean
  undoing: boolean
  onUndo: () => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const type = record.type ?? 'organize'
  const TypeIcon = HISTORY_ICONS[type]
  const canUndo =
    type === 'organize' && record.executed && !record.undone && (record.moves?.length ?? 0) > 0
  const cleanupErrors = record.cleanupSummary?.errors ?? []
  const outcome = record.cleanupSummary?.outcome
  const tone = recordTone(record)
  const sizeLabel = cleanupHistorySizeLabel(record, t)
  const processedLabel = cleanupHistoryProcessedLabel(record, t)
  const operationLabels = cleanupHistoryOperationLabels(record, t)
  const timeStr = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={cn('relative pl-14 pb-6', record.undone && 'opacity-60')}>
      {!isLast && (
        <div className="absolute left-[23px] top-10 bottom-0 w-px bg-iqon-border" />
      )}
      <div
        className={cn(
          'absolute left-0 top-1 z-10 flex h-12 w-12 items-center justify-center rounded-xl border',
          TONE_RING[tone]
        )}
      >
        <TypeIcon className="h-4 w-4" />
      </div>

      <div className="iqon-card iqon-card-hover p-4">
        <div className="mb-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="truncate text-sm font-bold text-foreground">{record.directory}</h4>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{t(HISTORY_TYPE_KEYS[type])}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded bg-iqon-row px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {timeStr}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                record.undone
                  ? 'bg-iqon-row text-muted-foreground'
                  : record.executed && (!outcome || outcome === 'success')
                    ? 'bg-iqon-green/10 text-iqon-green'
                    : 'bg-iqon-yellow/10 text-iqon-yellow'
              )}
            >
              {record.undone
                ? t('history.statusUndone')
                : outcome === 'failed' ? t('history.statusFailed')
                : outcome === 'skipped' ? t('history.statusSkipped')
                : outcome === 'partial' ? t('history.statusPartial')
                : outcome === 'unknown' ? t('history.statusUnknown')
                : record.executed
                  ? t('history.statusExecuted')
                  : t('history.statusPreview')}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {cleanupHistoryCountLabel(record, t)}
          {type !== 'organize' && sizeLabel && (
            <>
              {' · '}
              <span className="font-bold text-foreground">
                {sizeLabel}
              </span>
            </>
          )}
        </p>
        {(processedLabel || operationLabels.length > 0) && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {[processedLabel, ...operationLabels].filter(Boolean).join(' · ')}
          </p>
        )}
        {record.cleanupSummary?.systemCache && <SystemCacheHistoryDetail details={record.cleanupSummary.systemCache} />}
        {Object.keys(record.categories).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(record.categories).map(([cat, count]) => (
              <span
                key={cat}
                className="rounded-md border border-iqon-border bg-iqon-row px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground"
              >
                {cat}: {count}
              </span>
            ))}
          </div>
        )}
        {record.organizeErrors && record.organizeErrors.length > 0 && (
          <p className="mt-2 whitespace-pre-wrap text-[10px] text-iqon-yellow">
            {t('history.partialErrors')}: {record.organizeErrors.length}
          </p>
        )}
        {cleanupErrors.length > 0 && (
          <details className="mt-2 text-[10px] text-iqon-yellow">
            <summary className="cursor-pointer">{t('history.cleanupErrors')}: {cleanupErrors.length}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {cleanupErrors.map((error) => <li key={error} className="break-all">{error}</li>)}
            </ul>
          </details>
        )}
        {(record.cleanupSummary?.skippedCount ?? 0) > 0 && (
          <p className="mt-2 text-[10px] text-iqon-yellow">
            {t('history.cleanupSkipped', { n: record.cleanupSummary?.skippedCount ?? 0 })}
          </p>
        )}
        {record.cleanupSummary?.riskNotes?.map((note) => (
          <p key={note} className="mt-2 text-[10px] font-semibold text-iqon-red">
            {record.cleanupSummary?.irreversible ? '⚠ ' : ''}{note}
          </p>
        ))}
        <div className="mt-3 flex items-center justify-end gap-2">
          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={undoing}
              className="iqon-btn-secondary disabled:opacity-50"
            >
              {undoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
              {t('history.undo')}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-iqon-row hover:text-iqon-red"
            aria-label={t('history.clear')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
