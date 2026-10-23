export type AgentCleanupCategory =
  | 'cache'
  | 'log'
  | 'temporary'
  | 'orphan_worktree'
  | 'codex_internal_ref'
  | 'git_unreachable_object'

export interface AgentCleanupAgent {
  id: string
  name: string
  available?: boolean
  item_count?: number
  total_size?: number | null
}

export interface AgentCleanupItem {
  id: string
  agent: string
  category: AgentCleanupCategory
  path: string
  size: number
  size_status?: 'complete' | 'partial' | 'unavailable'
  modified_at?: string | number | null
  reason?: string | null
  default_selected: boolean
  protected: boolean
}

export interface AgentCleanupProtected {
  path: string
  agent: string
  reason: string
}

export interface AgentCleanupScanResult {
  scanned_at: string | number
  retention_days: number
  agents: AgentCleanupAgent[]
  items: AgentCleanupItem[]
  protected: AgentCleanupProtected[]
}

export interface AgentCleanupExecuteRequest {
  itemIds: string[]
  retentionDays: number
  confirmed: boolean
}

export interface AgentCleanupExecuteResult {
  removed_count: number
  processed_bytes?: number | null
  freed_bytes: number | null
  skipped_count?: number
  errors?: string[]
  completed_at?: string
  actions?: AgentCleanupAction[]
}

export interface AgentCleanupAction {
  path: string
  size_bytes: number | null
  success: boolean
  message: string
}

export const AGENT_CLEANUP_CATEGORIES: AgentCleanupCategory[] = [
  'cache',
  'log',
  'temporary',
  'orphan_worktree',
  'codex_internal_ref',
  'git_unreachable_object',
]
