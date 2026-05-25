import { useI18n } from '@/i18n'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { dedupeSpinnerLines } from './cleanProgress'

interface CleanScanStatusPanelProps {
  loading: boolean
  activity?: 'scan' | 'clean'
  scanIdle: boolean
  scanError: string | null
  scanElapsedMs: number
  scanOutput: string[]
}

export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`
}

export function CleanScanStatusPanel({
  loading,
  activity = 'scan',
  scanIdle,
  scanError,
  scanElapsedMs,
  scanOutput,
}: CleanScanStatusPanelProps) {
  const { t } = useI18n()
  const outputRef = useRef<HTMLDivElement>(null)
  const cleanedOutput = useMemo(() => dedupeSpinnerLines(scanOutput).slice(-80), [scanOutput])
  const statusLabel = scanError
    ? activity === 'clean' ? t('clean.cleanStatus.failed') : t('clean.scanStatus.failed')
    : loading
    ? scanIdle
      ? activity === 'clean' ? t('clean.cleanStatus.idle') : t('clean.scanStatus.idle')
      : activity === 'clean' ? t('clean.cleanStatus.running') : t('clean.scanStatus.running')
    : activity === 'clean' ? t('clean.cleanStatus.complete') : t('clean.scanStatus.complete')

  useEffect(() => {
    if (!outputRef.current) return
    outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [cleanedOutput])

  return (
    <div className="iqon-row mt-2 w-full max-w-2xl p-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2 font-bold text-foreground">
          {scanError ? (
            <AlertCircle className="h-4 w-4 text-iqon-red" />
          ) : loading ? (
            <Loader2 className={`h-4 w-4 animate-spin ${scanIdle ? 'text-iqon-yellow' : 'text-iqon-green'}`} />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-iqon-green" />
          )}
          {statusLabel}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatElapsed(scanElapsedMs)}
        </span>
      </div>

      {scanIdle && loading && (
        <p className="mt-3 text-[11px] text-iqon-yellow">
          {activity === 'clean' ? t('clean.cleanIdleHint') : t('clean.scanIdleHint')}
        </p>
      )}

      <div
        ref={outputRef}
        className="mt-3 max-h-40 overflow-auto rounded-xl border border-iqon-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
      >
        <p className="iqon-eyebrow mb-2 font-sans">{t('clean.scanStreamTitle')}</p>
        {cleanedOutput.length > 0 ? cleanedOutput.map((line, index) => (
          <p
            key={`${index}-${line}`}
            className={`break-words ${line.startsWith('[stderr]') ? 'text-iqon-red' : ''}`}
          >
            {line}
          </p>
        )) : (
          <p>{t('clean.scanStreamWaiting')}</p>
        )}
      </div>
    </div>
  )
}
