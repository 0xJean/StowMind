import { formatFileSize } from '@/lib/utils'
import type { AgentCleanupItem } from './types'

type SizeItem = Pick<AgentCleanupItem, 'size' | 'size_status'>
export interface AgentSizeSummary {
  bytes: number | null
  status: 'complete' | 'partial' | 'unavailable'
}
type Translate = (key: 'clean.summary.unknown' | 'clean.summary.atLeast', vars?: { size: string }) => string

/** Keep measured lower bounds without claiming that unmeasured items are empty. */
export function summarizeAgentSizes(items: SizeItem[]): AgentSizeSummary {
  let bytes = 0
  let complete = true
  for (const item of items) {
    const measured = item.size_status === undefined || item.size_status === 'complete' || item.size_status === 'partial'
    if (!measured || !Number.isSafeInteger(item.size) || item.size < 0) {
      complete = false
      continue
    }
    if (item.size_status === 'partial') complete = false
    if (!Number.isSafeInteger(bytes + item.size)) {
      // The already accumulated subset remains a valid lower bound.
      complete = false
      continue
    }
    bytes += item.size
  }
  if (complete) return { bytes, status: 'complete' }
  return bytes > 0 ? { bytes, status: 'partial' } : { bytes: null, status: 'unavailable' }
}

export function agentSizeLabel(summary: AgentSizeSummary, t: Translate) {
  if (summary.bytes === null) return t('clean.summary.unknown')
  const size = formatFileSize(summary.bytes)
  return summary.status === 'partial' ? t('clean.summary.atLeast', { size }) : size
}

export function agentItemSizeLabel(item: SizeItem, t: Translate) {
  return agentSizeLabel(summarizeAgentSizes([item]), t)
}
