import { useI18n } from '@/i18n'
import { recordSystemCacheCleanup } from '@/lib/stowmind-supplements/systemCacheHistory'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import type { MoleCleanPreviewOutput } from '../clean/types'
import type { MoleCleanInteractionRequest } from '../clean/useCleanPtyInteraction'
import { canCleanSystemCache } from './helpers'
import type { SystemCacheCleanupOutcome, SystemCacheReport } from './types'

type Activity = 'scan' | 'review' | 'clean' | null

export function useSystemCache(active: boolean) {
  const { t } = useI18n()
  const [report, setReport] = useState<SystemCacheReport | null>(null)
  const [outcome, setOutcome] = useState<SystemCacheCleanupOutcome | null>(null)
  const [activity, setActivity] = useState<Activity>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [interaction, setInteraction] = useState<MoleCleanInteractionRequest | null>(null)
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const busyRef = useRef(false)
  const runRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)
  const cancellingRef = useRef(false)
  const mountedRef = useRef(true)
  const unlistenRef = useRef<(() => void)[]>([])

  const resetInteraction = () => {
    setInteraction(null)
    setInput('')
    setSubmitting(false)
  }

  const cancel = async () => {
    const runId = runRef.current
    if (!runId || cancellingRef.current) return
    cancelledRef.current = true
    cancellingRef.current = true
    setCancelling(true)
    resetInteraction()
    unlistenRef.current.splice(0).forEach((unlisten) => unlisten())
    try {
      await invoke('mole_clean_preview_pty_cancel', { runId })
    } catch (cause) {
      cancellingRef.current = false
      if (mountedRef.current) {
        setError(String(cause))
        setCancelling(false)
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
      unlistenRef.current.splice(0).forEach((unlisten) => unlisten())
      if (runRef.current) {
        void invoke('mole_clean_preview_pty_cancel', { runId: runRef.current }).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    if (!active && runRef.current) void cancel()
    // Leaving the keep-alive page must close its password prompt and stop work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const run = async (kind: Exclude<Activity, null>, token?: string) => {
    if (busyRef.current) return
    busyRef.current = true
    cancelledRef.current = false
    setActivity(kind)
    setError(null)
    setProgress('')
    setReport((current) => current ? { ...current, review_token: null } : null)
    resetInteraction()
    const runId = `system-cache-${crypto.randomUUID()}`
    runRef.current = kind === 'scan' ? null : runId

    try {
      if (kind !== 'scan') {
        const stopOutput = await listen<MoleCleanPreviewOutput>('mole-clean-preview-output', (event) => {
          if (event.payload.run_id === runId && mountedRef.current && !cancelledRef.current) setProgress(event.payload.line)
        })
        // listen() registers asynchronously. Cancellation or unmount can occur
        // while it is pending, so release late subscriptions immediately.
        if (cancelledRef.current || !mountedRef.current || runRef.current !== runId) {
          stopOutput()
          return
        }
        unlistenRef.current.push(stopOutput)
        const stopInteraction = await listen<MoleCleanInteractionRequest>('mole-clean-interaction-request', (event) => {
          if (event.payload.run_id !== runId || !mountedRef.current || cancelledRef.current) return
          setInteraction(event.payload)
          setInput('')
          setSubmitting(false)
        })
        if (cancelledRef.current || !mountedRef.current || runRef.current !== runId) {
          stopInteraction()
          return
        }
        unlistenRef.current.push(stopInteraction)
      }

      if (kind === 'clean') {
        const next = await invoke<SystemCacheCleanupOutcome>('system_cache_clean', {
          runId, reviewToken: token, confirmed: true,
        })
        // Persist the execution before updating UI; keep it even when the
        // post-clean measurement was incomplete or the page became hidden.
        recordSystemCacheCleanup(next, t('history.type.system-cache'))
        if (!mountedRef.current) return
        setOutcome(next)
        setReport(next.after)
        if (next.success) toast.success(t('systemCache.cleanCompleted'))
        else setError(next.errors.join('\n') || t('systemCache.cleanIncomplete'))
      } else {
        const next = await invoke<SystemCacheReport>(kind === 'scan' ? 'system_cache_scan' : 'system_cache_review',
          kind === 'scan' ? undefined : { runId })
        if (mountedRef.current && !cancelledRef.current) setReport(next)
      }
    } catch (cause) {
      if (mountedRef.current) {
        setError(cancelledRef.current ? t('systemCache.cancelled') : String(cause))
      }
    } finally {
      unlistenRef.current.splice(0).forEach((unlisten) => unlisten())
      runRef.current = null
      busyRef.current = false
      cancellingRef.current = false
      if (mountedRef.current) {
        resetInteraction()
        setActivity(null)
        setCancelling(false)
      }
    }
  }

  const clean = async () => {
    if (busyRef.current || !canCleanSystemCache(report)) return
    if (!window.confirm(t('systemCache.cleanConfirm', { path: report.path }))) return
    await run('clean', report.review_token!)
  }

  const submit = async (value?: string) => {
    if (!interaction || submitting) return
    setSubmitting(true)
    try {
      await invoke('mole_clean_preview_pty_submit_interaction', {
        runId: interaction.run_id, input: value ?? input,
      })
      resetInteraction()
    } catch (cause) {
      setError(String(cause))
      setSubmitting(false)
    }
  }

  return {
    report, outcome, activity, error, progress, interaction, input, submitting, cancelling,
    scan: () => run('scan'), review: () => run('review'), clean, cancel, submit, setInput,
  }
}
