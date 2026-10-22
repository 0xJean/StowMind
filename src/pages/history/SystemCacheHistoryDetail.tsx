import { useI18n } from '@/i18n'
import { formatDate, formatFileSize } from '@/lib/utils'
import type { CacheMeasurementHistory, SystemCacheHistoryDetails } from '@/stores/app'

export function SystemCacheHistoryDetail({ details }: { details: SystemCacheHistoryDetails }) {
  const { t } = useI18n()
  const formatMeasurement = (value: CacheMeasurementHistory) => {
    const size = value.sizeBytes === null ? t('history.cacheUnknown') : formatFileSize(value.sizeBytes)
    return `${size} · ${t(`systemCache.status.${value.status}` as Parameters<typeof t>[0])}`
  }
  const delta = details.observedDeltaBytes
  return (
    <div className="mt-3 space-y-1 rounded-xl border border-iqon-border bg-iqon-row p-3 text-xs text-muted-foreground">
      <p>{t('history.cacheEngine')}</p>
      <p>{t('history.cacheBefore', { value: formatMeasurement(details.before) })}</p>
      <p>{t('history.cacheAfter', { value: formatMeasurement(details.after) })}</p>
      <p className="font-semibold text-foreground">
        {delta === null ? t('history.cacheDeltaUnknown') : delta < 0
          ? t('history.cacheIncreased', { size: formatFileSize(Math.abs(delta)) })
          : t('history.cacheReduced', { size: formatFileSize(delta) })}
      </p>
      <p>{t('history.cacheObservedNotice')}</p>
      <p>{t('history.cacheRecheckedAt', { time: formatDate(new Date(details.after.scannedAt * 1000).toISOString()) })}</p>
      {details.moleMessage && <p className="break-words">{details.moleMessage}</p>}
      {details.after.message && <p className="break-words">{details.after.message}</p>}
    </div>
  )
}
