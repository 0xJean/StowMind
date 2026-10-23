import type { useI18n } from '@/i18n'
import { useAppStore } from '@/stores/app'
import {
  buildCleanExecutionOutputLines,
  buildExecutedCleanPreview,
  combineCleanRawOutput,
  parseCleanOperationLog,
  summarizeCleanExecution,
} from './cleanExecutionResult'
import type { CleanCompletionResult, CleanCompletionStatus, MoleCleanPreview } from './types'

export interface CleanCompletionInput {
  status: CleanCompletionStatus
  previewToArchive: MoleCleanPreview
  rawOutput: string
  operationLog: string
  outputLines: string[]
  startedAt: number
}

/** Only execution evidence contributes to cumulative cleanup metrics. */
export function recordCleanCompletion(input: CleanCompletionInput, t: ReturnType<typeof useI18n>['t']): CleanCompletionResult {
  const { previewToArchive, rawOutput, operationLog, outputLines, startedAt } = input
  const combinedRawOutput = combineCleanRawOutput(rawOutput, operationLog)
  const summary = summarizeCleanExecution(outputLines, rawOutput, operationLog)
  const hasExecutionEvidence = (summary.itemCount ?? 0) > 0 || summary.operationCount > 0
    || (summary.totalSize ?? 0) > 0 || (summary.processedSize ?? 0) > 0
  const status = input.status === 'cancelled' ? 'cancelled'
    : summary.failedCount > 0 ? hasExecutionEvidence ? 'partial' : 'failed'
      : input.status === 'failed' ? hasExecutionEvidence ? 'partial' : 'failed'
        : summary.operationLogStatus === 'ambiguous' ? 'partial' : input.status
  const preview = buildExecutedCleanPreview(previewToArchive, summary, combinedRawOutput, {
    confirmedSectionTitle: t(status === 'cancelled' ? 'clean.cancelledScopeTitle' : 'clean.completedScopeTitle'),
  })
  const timestamp = new Date().toISOString()
  const notes = parseCleanOperationLog(operationLog || rawOutput)
    .filter((record) => record.action === 'FAILED').slice(0, 50).map((record) => record.label)
  const knownEmpty = summary.itemCount === 0 && (summary.totalSize === null || summary.totalSize === 0)
  if (status === 'cancelled') notes.push(t('clean.cancelledHistoryNote'))
  if (summary.operationLogStatus === 'ambiguous') notes.push(t('clean.result.logAmbiguous'))
  if (!hasExecutionEvidence && !knownEmpty) notes.push(t('clean.summary.executionUnknown'))
  const hasFreedSize = summary.totalSize !== null
  const recordedSize = summary.totalSize ?? summary.processedSize
  const state = useAppStore.getState()
  state.addHistory({
    id: `clean-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'clean', timestamp, directory: t('clean.title'),
    totalFiles: summary.itemCount ?? 0,
    categories: summary.itemCount === null ? {} : { [t('history.type.clean')]: summary.itemCount },
    executed: hasExecutionEvidence, moves: [],
    cleanupSummary: {
      action: 'execute', itemCount: summary.itemCount ?? undefined,
      itemCountSource: summary.itemCountSource,
      operationCount: summary.operationCount, operationLogStatus: summary.operationLogStatus,
      failedCount: summary.failedCount,
      processedSize: summary.processedSize ?? undefined, processedSizeKind: summary.processedSizeKind,
      totalSize: recordedSize ?? undefined,
      sizeKind: hasFreedSize ? 'reported_freed' : recordedSize !== null ? 'processed' : 'unknown',
      outcome: status === 'failed' ? 'failed' : hasExecutionEvidence
        ? status === 'cancelled' || status === 'partial' ? 'partial' : 'success'
        : summary.operationLogStatus === 'ambiguous' ? 'unknown' : knownEmpty ? 'skipped' : 'unknown',
      skippedCount: summary.skippedCount,
      errors: notes.length ? notes : undefined,
    },
  })
  state.updateStatistics({
    cleanItemsRemoved: (state.statistics.cleanItemsRemoved ?? 0) + (summary.itemCount ?? 0),
    cleanSizeFreed: (state.statistics.cleanSizeFreed ?? 0) + (summary.totalSize ?? 0),
    reportedFreedBytes: (state.statistics.reportedFreedBytes ?? 0) + (summary.totalSize ?? 0),
    cleanOperationCount: (state.statistics.cleanOperationCount ?? 0) + (hasExecutionEvidence ? 1 : 0),
    ...(hasExecutionEvidence ? { lastCleaned: timestamp } : {}),
  })
  return {
    preview, summary, rawOutput: combinedRawOutput,
    outputLines: buildCleanExecutionOutputLines(outputLines, rawOutput, operationLog),
    completedAt: timestamp, elapsedMs: Date.now() - startedAt, status,
  }
}
