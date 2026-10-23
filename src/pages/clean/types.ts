export interface MoleCleanItem {
  label: string
  size?: number | null
  count?: number | null
  status: 'dry_run' | 'ok' | 'skipped' | 'advice' | 'info' | 'detail' | string
}

export interface MoleCleanSection {
  title: string
  items: MoleCleanItem[]
}

export interface MoleCleanPreview {
  potential_space: number | null
  item_count: number | null
  category_count: number | null
  summary_status?: 'exact' | 'at_least' | 'unavailable'
  scan_status?: 'complete' | 'incomplete' | 'unknown'
  sections: MoleCleanSection[]
  raw_output: string
}
export interface MoleCleanPreviewOutput {
  run_id: string
  stream: string
  line: string
}

export interface MoleCleanExecutionResult {
  raw_output: string
  operation_log: string
}

export type CleanCompletionStatus = 'completed' | 'partial' | 'failed' | 'cancelled'

export interface CleanCompletionResult {
  summary: CleanExecutionSummary
  preview: MoleCleanPreview
  rawOutput: string
  outputLines: string[]
  completedAt: string
  elapsedMs: number
  status: CleanCompletionStatus
}

export function getCleanItemSize(item: { size?: number | null }) {
  return typeof item.size === 'number' && item.size > 0 ? item.size : 0
}

export function sortCleanSectionsBySize(sections: MoleCleanSection[]) {
  return [...sections].sort((a, b) => sectionSize(b) - sectionSize(a))
}

function sectionSize(section: MoleCleanSection) {
  return section.items.reduce((sum, item) => sum + getCleanItemSize(item), 0)
}
import type { CleanExecutionSummary } from './cleanExecutionResult'
