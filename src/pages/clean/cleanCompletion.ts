import type { useI18n } from '@/i18n'
import { useAppStore } from '@/stores/app'
import {
  buildCleanExecutionOutputLines,
  buildExecutedCleanPreview,
  combineCleanRawOutput,
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
  const { status, previewToArchive, rawOutput, operationLog, outputLines, startedAt } = input
  const combinedRawOutput = combineCleanRawOutput(rawOutput, operationLog)
  const summary = summarizeCleanExecution(outputLines, rawOutput, operationLog)
  const preview = buildExecutedCleanPreview(previewToArchive, summary, combinedRawOutput, {
    confirmedSectionTitle: t(status === 'cancelled' ? 'clean.cancelledScopeTitle' : 'clean.completedScopeTitle'),
  })
  const timestamp = new Date().toISOString()
  const notes: string[] = []
  const hasExecutionEvidence = (summary.itemCount ?? 0) > 0 || (summary.totalSize ?? 0) > 0
  const knownEmpty = summary.itemCount === 0 && (summary.totalSize === null || summary.totalSize === 0)
  if (status === 'cancelled') notes.push(t('clean.cancelledHistoryNote'))
  if (summary.totalSize === null || summary.itemCount === null) notes.push(t('clean.summary.executionUnknown'))
  const state = useAppStore.getState()
  state.addHistory({
    id: `clean-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'clean', timestamp, directory: t('clean.title'),
    totalFiles: summary.itemCount ?? 0,
    categories: summary.itemCount === null ? {} : { [t('history.type.clean')]: summary.itemCount },
    executed: hasExecutionEvidence, moves: [],
    cleanupSummary: {
      action: 'execute', itemCount: summary.itemCount ?? undefined,
      totalSize: summary.totalSize ?? undefined,
      sizeKind: summary.totalSize === null ? 'unknown' : 'reported_freed',
      outcome: hasExecutionEvidence ? status === 'cancelled' ? 'partial' : 'success' : knownEmpty ? 'skipped' : 'unknown',
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
    preview, rawOutput: combinedRawOutput,
    outputLines: buildCleanExecutionOutputLines(outputLines, rawOutput, operationLog),
    completedAt: timestamp, elapsedMs: Date.now() - startedAt, status,
  }
}
