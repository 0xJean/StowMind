import type { CleanupSummary, HistoryRecord, HistoryRecordType } from '@/stores/app'

type CleanupHistoryType = Exclude<HistoryRecordType, 'organize'>

interface CleanupHistoryInput {
  type: CleanupHistoryType
  target: string
  label: string
  itemCount: number
  totalSize: number
  action: CleanupSummary['action']
  executed?: boolean
  errors?: string[]
  timestamp?: string
}

function historyId(type: HistoryRecordType) {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${Date.now()}-${type}-${suffix}`
}

export function createCleanupHistoryRecord(input: CleanupHistoryInput): HistoryRecord {
  const timestamp = input.timestamp ?? new Date().toISOString()

  return {
    id: historyId(input.type),
    type: input.type,
    timestamp,
    directory: input.target,
    totalFiles: input.itemCount,
    categories: { [input.label]: input.itemCount },
    executed: input.executed ?? input.action !== 'preview',
    moves: [],
    cleanupSummary: {
      itemCount: input.itemCount,
      totalSize: input.totalSize,
      action: input.action,
      errors: input.errors && input.errors.length > 0 ? input.errors : undefined,
    },
  }
}
