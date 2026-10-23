import { invoke } from '@tauri-apps/api/tauri'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { maintenanceFailure, type MaintenanceFailure, type MaintenancePhase, type MaintenanceResult } from '@/lib/maintenanceRun'

interface ActiveRun {
  id: string
  phase: MaintenancePhase
  settled: boolean
  cancelRequested: boolean
  cleanupPending: boolean
  exitConfirmed: boolean
  cancelPromise: Promise<void> | null
}
export interface MaintenanceState {
  run: { id: string; phase: MaintenancePhase } | null
  cancelling: boolean
  cancelError: string | null
  failure: MaintenanceFailure | null
  output: string
  outputTruncated?: boolean
}
let sequence = 0

/** One native run per page. Cancellation never unlocks a still-running task. */
export function useMaintenanceRun(route: string) {
  const active = useLocation().pathname === route
  const activeRef = useRef(active)
  activeRef.current = active
  const mounted = useRef(true)
  const current = useRef<ActiveRun | null>(null)
  const [state, setState] = useState<MaintenanceState>({ run: null, cancelling: false, cancelError: null, failure: null, output: '' })
  const publish = useCallback((patch: Partial<MaintenanceState>) => {
    if (mounted.current) setState((previous) => ({ ...previous, ...patch }))
  }, [])
  const release = useCallback((run: ActiveRun) => {
    if (current.current === run && run.settled && !run.cancelPromise && !run.cleanupPending) {
      current.current = null
      publish({ run: null, cancelling: false, cancelError: null })
    }
  }, [publish])
  const cancel = useCallback(async () => {
    const run = current.current
    if (!run || run.cancelPromise) return
    run.cancelRequested = true
    publish({ cancelling: true, cancelError: null })
    const pending = invoke<void>('maintenance_cancel', { runId: run.id })
    run.cancelPromise = pending
    try {
      await pending
      run.exitConfirmed = true
      run.cleanupPending = false
    } catch (cause) {
      if (current.current === run) publish({ cancelError: maintenanceFailure(cause).message })
    } finally {
      run.cancelPromise = null
      if (current.current === run) publish({ cancelling: false })
      release(run)
    }
  }, [publish, release])
  const run = useCallback(async <T,>(phase: MaintenancePhase, command: string, args: Record<string, unknown> = {}): Promise<MaintenanceResult<T> | null> => {
    if (current.current || !mounted.current || !activeRef.current) return null
    const task: ActiveRun = { id: `maintenance-${Date.now()}-${++sequence}`, phase, settled: false, cancelRequested: false, cleanupPending: false, exitConfirmed: false, cancelPromise: null }
    current.current = task
    publish({ run: { id: task.id, phase }, cancelling: false, cancelError: null, failure: null, output: '', outputTruncated: false })
    try {
      const value = await invoke<T>(command, { ...args, runId: task.id })
      const captured = value as { raw_output?: string; output_truncated?: boolean }
      const raw = captured?.raw_output
      if (raw) publish({ output: raw, outputTruncated: captured.output_truncated === true })
      if (task.cancelRequested) publish({ failure: { code: 'cancelled', message: '', raw_output: raw ?? '', output_truncated: false } })
      return { ok: true, value, interrupted: task.cancelRequested }
    } catch (cause) {
      const error = maintenanceFailure(cause)
      task.cleanupPending = error.cleanup_pending === true && !task.exitConfirmed
      publish({ failure: error, outputTruncated: error.output_truncated, ...(error.raw_output ? { output: error.raw_output } : {}) })
      return { ok: false, error }
    } finally {
      task.settled = true
      // The invocation response proves completion; a cancellation RPC that is
      // still pending must also settle before another task may enter this lane.
      if (task.cancelPromise) await task.cancelPromise.catch(() => {})
      release(task)
    }
  }, [publish, release])
  useEffect(() => {
    if (!active) void cancel()
  }, [active, cancel])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; void cancel() }
  }, [cancel])
  return { ...state, active, busy: Boolean(state.run), runTask: run, cancel, isVisible: () => mounted.current && activeRef.current, isBusy: () => current.current !== null }
}
