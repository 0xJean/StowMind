import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import { AlertCircle, Ban, CheckCircle2, Clock, Database, Files, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { formatElapsed } from './CleanScanStatusPanel'
import { CleanOperationLogPanel } from './CleanOperationLogPanel'
import { CleanExecutionOutputPanel } from './CleanExecutionOutputPanel'
import { parseCleanOperationLog, splitCleanOperationLog, summarizeCleanExecution } from './cleanExecutionResult'
import type { CleanExecutionSummary } from './cleanExecutionResult'
import type { CleanCompletionStatus, MoleCleanPreview } from './types'

interface CleanCompletedPanelProps {
  preview: MoleCleanPreview
  summary?: CleanExecutionSummary
  rawOutput: string
  outputLines: string[]
  completedAt: string
  elapsedMs: number
  status?: CleanCompletionStatus
  onRescan: () => void
}

export function CleanCompletedPanel({
  summary, rawOutput, outputLines, completedAt, elapsedMs, status = 'completed', onRescan,
}: CleanCompletedPanelProps) {
  const { t } = useI18n()
  const parts = useMemo(() => splitCleanOperationLog(rawOutput), [rawOutput])
  const result = useMemo(() => summary ?? summarizeCleanExecution(outputLines, parts.rawOutput, parts.operationLog), [summary, outputLines, parts])
  const records = useMemo(() => parseCleanOperationLog(parts.operationLog || rawOutput), [parts.operationLog, rawOutput])
  const cancelled = status === 'cancelled'
  const failed = status === 'failed'
  const partial = status === 'partial' || result.failedCount > 0
  const unconfirmed = result.itemCount === null && result.totalSize === null && result.processedSize === null && result.operationCount === 0
  const ambiguousLog = result.operationLogStatus === 'ambiguous'
  const warning = cancelled || partial || failed || unconfirmed || ambiguousLog
  const title = cancelled ? 'clean.cancelledTitle' : failed ? 'clean.result.failedTitle'
    : partial ? 'clean.result.partialTitle' : unconfirmed || ambiguousLog ? 'history.statusUnknown' : 'clean.completedTitle'
  const description = cancelled ? 'clean.cancelledScopeDesc' : failed ? 'clean.result.failedDesc'
    : ambiguousLog ? 'clean.result.logAmbiguous' : result.failedCount > 0 ? 'clean.result.partialDesc'
      : unconfirmed ? 'clean.summary.executionUnknown' : 'clean.completedSubtitle'
  const processedValue = result.processedSize === null
    ? t(result.processedSizeKind === 'partial' ? 'clean.result.processedPartial' : 'clean.result.notReported')
    : result.processedSizeKind === 'at_least'
      ? t('clean.result.processedAtLeast', { size: formatFileSize(result.processedSize) })
      : formatFileSize(result.processedSize)
  const processedHint = result.processedSizeKind === 'unspecified'
    ? `${t('clean.result.processedReported')} ${t('clean.result.processedUnspecified')}`
    : result.processedSizeKind === 'partial'
      ? `${t('clean.result.processedReported')} ${t('clean.result.processedPartial')}`
      : t('clean.result.processedReported')
  const itemLabel = result.itemCountSource === 'mole' ? 'clean.result.moleItems'
    : result.itemCountSource === 'operation_log' ? 'clean.result.operationItems' : 'clean.result.unknownItems'
  // A completed result retains stdout separately from its operation ledger.
  const stdout = parts.rawOutput.trim() || (rawOutput.trim() ? '' : outputLines.join('\n'))

  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('clean.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t(description, { count: result.failedCount })}</p>
        </div>
      </div>

      <Card className={`overflow-hidden ${warning ? 'border-iqon-yellow/30' : 'border-iqon-green/30'}`}>
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${warning ? 'bg-iqon-yellow/15 text-iqon-yellow' : 'bg-iqon-green/15 text-iqon-green'}`}>
                {cancelled ? <Ban className="h-8 w-8" /> : warning ? <AlertCircle className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
              </div>
              <div>
                <CardTitle className="text-3xl">{t(title)}</CardTitle>
                <CardDescription className="mt-2 max-w-xl">{t(description, { count: result.failedCount })}</CardDescription>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={onRescan}>
              <RefreshCw className="mr-2 h-4 w-4" />{t('clean.completedRescan')}
            </Button>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ResultStat icon={<Database className="h-4 w-4" />} label={t('clean.result.processedSize')} value={processedValue} hint={processedHint} />
            <ResultStat icon={<Database className="h-4 w-4" />} label={t('clean.result.freedSize')}
              value={result.totalSize === null ? t('clean.result.notReported') : formatFileSize(result.totalSize)} />
            <ResultStat icon={<Files className="h-4 w-4" />} label={t(itemLabel)} value={String(result.itemCount ?? t('clean.result.notReported'))} />
            <ResultStat icon={<Files className="h-4 w-4" />} label={t('clean.result.logItems')}
              value={result.operationLogStatus === 'available' ? String(result.operationCount) : t(ambiguousLog ? 'clean.result.ambiguous' : 'clean.result.notReported')}
              hint={t('clean.result.logCountHint')} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{t('clean.completedTimeLabel')}: {formatElapsed(elapsedMs)}</span>
            <span>{new Date(completedAt).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
      <CleanOperationLogPanel records={records} status={result.operationLogStatus} />
      <CleanExecutionOutputPanel output={stdout} />
    </div>
  )
}

function ResultStat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="iqon-row p-4">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<p className="iqon-eyebrow">{label}</p></div>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}
