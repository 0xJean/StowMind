export type MaintenancePhase = 'scan' | 'preview' | 'execute'
export interface MaintenanceFailure {
  code: 'cancelled' | 'timeout' | 'busy' | 'invalid_run' | 'failed'
  message: string
  raw_output: string
  output_truncated: boolean
  cleanup_pending?: boolean
  partial_result?: unknown
}

export function maintenanceFailure(value: unknown): MaintenanceFailure {
  if (typeof value === 'string') {
    try { return maintenanceFailure(JSON.parse(value)) } catch { /* Plain native error. */ }
  }
  const source = value && typeof value === 'object' ? value as Partial<MaintenanceFailure> : {}
  return {
    code: source.code ?? 'failed', message: source.message ?? String(value),
    raw_output: source.raw_output ?? '', output_truncated: source.output_truncated ?? false,
    cleanup_pending: source.cleanup_pending,
    partial_result: source.partial_result,
  }
}

export type MaintenanceResult<T> =
  | { ok: true; value: T; interrupted: boolean }
  | { ok: false; error: MaintenanceFailure }
