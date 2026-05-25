import type { MoleStatusMetrics } from '../status/types'

export type MoleDoctorLevel = 'success' | 'warning' | 'destructive'

export interface MoleDoctorCheck {
  title: string
  detail: string
  level: MoleDoctorLevel
  action?: string | null
  section?: string
}

export interface MoleDoctorResult {
  collected_at: string
  platform: string
  health_score: number
  health_score_msg: string
  status: MoleStatusMetrics
  checks: MoleDoctorCheck[]
  update_available: boolean
  update_message: string | null
  console_command: string
  raw_output: string
}
