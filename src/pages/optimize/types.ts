export interface MoleOptimizationItem {
  category: string
  name: string
  description: string
  action: string
  safe: boolean
}

export interface MoleOptimizeHealth {
  health_score: number | null
  health_score_msg: string
  memory_used_gb: number | null
  memory_total_gb: number | null
  disk_used_gb: number | null
  disk_total_gb: number | null
  disk_used_percent: number | null
  uptime_days: number | null
  active_whitelist: string[]
  optimizations: MoleOptimizationItem[]
  raw_output: string
  platform: string
  preview_status?: string
  planned_count?: number | null
}

export interface MoleOptimizeExecuteOutcome {
  output_truncated?: boolean
  applied_count: number | null
  summary_status: string
  raw_output: string
}
