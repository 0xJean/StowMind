import type { CleanupSummary, HistoryRecord, HistoryRecordType } from '@/stores/app'

type CleanupHistoryType = Exclude<HistoryRecordType, 'organize'>

interface CleanupHistoryInput {
  type: CleanupHistoryType
  target: string
  label: string
  itemCount: number | null | undefined
  totalSize: number | null | undefined
  sizeKind?: CleanupSummary['sizeKind']
  action: CleanupSummary['action']
  executed?: boolean
  errors?: string[]
  skippedCount?: number
  riskNotes?: string[]
  irreversible?: boolean
  outcome?: CleanupSummary['outcome']
  categoryCounts?: Record<string, number>
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
    totalFiles: input.itemCount ?? 0,
    categories: input.categoryCounts ?? (input.itemCount == null ? {} : { [input.label]: input.itemCount }),
    executed: input.executed ?? input.action !== 'preview',
    moves: [],
    cleanupSummary: {
      itemCount: input.itemCount ?? undefined,
      totalSize: input.totalSize ?? undefined,
      sizeKind: input.sizeKind ?? (input.action === 'preview' ? 'estimated' : 'unknown'),
      action: input.action,
      errors: input.errors && input.errors.length > 0 ? input.errors : undefined,
      skippedCount: input.skippedCount,
      riskNotes: input.riskNotes && input.riskNotes.length > 0 ? input.riskNotes : undefined,
      irreversible: input.irreversible,
      outcome: input.outcome,
    },
  }
}
