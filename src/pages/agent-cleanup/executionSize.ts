import type { useI18n } from '@/i18n'
import { formatFileSize } from '@/lib/utils'
import type { AgentCleanupExecuteResult } from './types'

export interface AgentExecutionSize {
  bytes: number | null
  kind: 'reported' | 'at_least' | 'unspecified' | 'unavailable'
}

/** Native execution evidence only: preview sizes cannot complete a partial report. */
export function summarizeAgentExecutionSize(result: AgentCleanupExecuteResult): AgentExecutionSize {
  // Legacy freed_bytes measured processed files, including moves to Trash.
  const value = 'processed_bytes' in result ? result.processed_bytes : result.freed_bytes
  const status = result.processed_size_status
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0
    || status === 'unavailable' || (status === 'partial' && value === 0)) {
    return { bytes: null, kind: 'unavailable' }
  }
  if (status === 'complete') return { bytes: value, kind: 'reported' }
  if (status === 'partial') return { bytes: value, kind: 'at_least' }
  if (status === undefined) return { bytes: value, kind: 'unspecified' }
  return { bytes: null, kind: 'unavailable' }
}

export function agentExecutionSizeLabel(size: AgentExecutionSize, t: ReturnType<typeof useI18n>['t']) {
  if (size.bytes === null) return t('clean.summary.unknown')
  const value = formatFileSize(size.bytes)
  return size.kind === 'at_least' ? t('clean.summary.atLeast', { size: value })
    : size.kind === 'unspecified' ? t('agentCleanup.sizeUnspecified', { size: value }) : value
}
