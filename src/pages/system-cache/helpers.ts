import type { SystemCacheReport } from './types'

export function hasMeasuredSize(report: SystemCacheReport | null) {
  return report?.status === 'complete'
    && typeof report.size_bytes === 'number'
    && Number.isFinite(report.size_bytes)
    && report.size_bytes >= 0
}

export function canCleanSystemCache(report: SystemCacheReport | null): report is SystemCacheReport {
  return hasMeasuredSize(report)
    && (report?.size_bytes ?? 0) > 0
    && report?.authorized === true
    && report.mole_supported
    && Boolean(report.review_token)
}

export function measurementDeltaLabel(
  bytes: number | null,
  t: (key: 'systemCache.unknownSize' | 'systemCache.decreased' | 'systemCache.increased', vars?: Record<string, string | number>) => string,
  formatSize: (bytes: number) => string
) {
  if (bytes === null || !Number.isFinite(bytes)) return t('systemCache.unknownSize')
  return t(bytes < 0 ? 'systemCache.increased' : 'systemCache.decreased', { size: formatSize(Math.abs(bytes)) })
}

export function statusLabelKey(report: SystemCacheReport) {
  return report.status === 'complete' && report.anomaly === true
    ? 'systemCache.status.anomaly' as const
    : `systemCache.status.${report.status}` as const
}
