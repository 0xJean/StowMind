export type SystemCacheStatus =
  | 'complete'
  | 'not_found'
  | 'permission_denied'
  | 'timed_out'
  | 'partial'
  | 'unsupported'
  | 'error'

export interface SystemCacheReport {
  source: 'stowmind_supplement'
  target_id: 'iconservices'
  path: string
  scanned_at: number
  status: SystemCacheStatus
  size_bytes: number | null
  modified_at: number | null
  authorized: boolean
  anomaly: boolean | null
  threshold_bytes: number
  message: string
  mole_supported: boolean
  mole_message: string
  review_token: string | null
}

export interface SystemCacheCleanupOutcome {
  source: 'mole'
  before: SystemCacheReport
  after: SystemCacheReport
  success: boolean
  attempted: boolean
  errors: string[]
  measured_delta_bytes: number | null
  completed_at: number
}
