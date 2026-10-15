import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import type { IosExecutionSession, IosProgressEvent, IosScanProgress } from '@/lib/ios'

interface ExecutionEventsOptions {
  planId?: string
  clearVerification: () => void
  setBusy: (value: boolean) => void
  setError: (value: string) => void
  executionError: string
}

/** Keep cancellation authoritative over results already in flight from Tauri. */
export function useIosExecutionEvents(options: ExecutionEventsOptions) {
  const [session, setSessionState] = useState<IosExecutionSession | null>(null)
  const [progress, setProgress] = useState<IosProgressEvent | null>(null)
  const [scanProgress, setScanProgress] = useState<IosScanProgress | null>(null)
  const sessionRef = useRef<IosExecutionSession | null>(null)
  const cancelledIds = useRef(new Set<string>())
  const retiredIds = useRef(new Set<string>())
  const optionsRef = useRef(options)
  optionsRef.current = options

  const acceptSession = (next: IosExecutionSession) => {
    if (retiredIds.current.has(next.id)) return false
    if (cancelledIds.current.has(next.id) && next.status !== 'cancelled') return false
    const current = sessionRef.current
    return !(current?.id === next.id
      && ['completed', 'failed', 'cancelled'].includes(current.status)
      && current.status !== next.status)
  }
  const setSession = (next: IosExecutionSession | null) => {
    if (next && !acceptSession(next)) return false
    if (!next && sessionRef.current) retiredIds.current.add(sessionRef.current.id)
    if (next?.status === 'cancelled') {
      cancelledIds.current.add(next.id)
      next = { ...next, guidanceCanResume: false }
    }
    sessionRef.current = next
    setSessionState(next)
    return true
  }

  useEffect(() => {
    const receiveSession = (next: IosExecutionSession) => {
      if (!setSession(next)) return
      const currentOptions = optionsRef.current
      currentOptions.clearVerification()
      currentOptions.setBusy(false)
      if (next.status === 'failed') {
        currentOptions.setError(next.error ?? currentOptions.executionError)
      }
    }
    const listeners = [
      listen<IosScanProgress>('ios-scan-progress', (event) => setScanProgress(event.payload)),
      listen<IosProgressEvent>('ios-execution-progress', (event) => {
        const payload = event.payload
        const previous = sessionRef.current
        const next: IosExecutionSession = {
          id: payload.sessionId,
          planId: previous?.id === payload.sessionId
            ? previous.planId : optionsRef.current.planId ?? '',
          status: payload.status === 'paused' ? 'paused' : 'running',
          currentIndex: payload.current,
          total: payload.total,
          createdAt: previous?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          guidanceCanResume: false,
        }
        if (!setSession(next)) return
        optionsRef.current.clearVerification()
        setProgress(payload)
      }),
      ...['paused', 'completed', 'failed', 'cancelled'].map((status) =>
        listen<IosExecutionSession>(`ios-execution-${status}`, (event) => receiveSession(event.payload))),
    ]
    return () => {
      for (const listener of listeners) void listener.then((unlisten) => unlisten())
    }
  }, [])

  return {
    session, setSession, progress, setProgress, scanProgress, setScanProgress,
    markCancellation: (id: string) => cancelledIds.current.add(id),
    cancellationRequested: () => Boolean(sessionRef.current && cancelledIds.current.has(sessionRef.current.id)),
  }
}
