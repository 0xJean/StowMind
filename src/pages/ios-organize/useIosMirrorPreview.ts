import { invoke } from '@tauri-apps/api/tauri'
import { appWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'

export type IosMirrorPreviewState = 'idle' | 'starting' | 'live' | 'error'

interface UseIosMirrorPreviewOptions {
  active: boolean
  enabled: boolean
}

interface MirrorPreviewRequest {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

function boundsKey(request: MirrorPreviewRequest) {
  return [
    request.offsetX,
    request.offsetY,
    request.width,
    request.height,
  ].map((value) => Math.round(value * 2) / 2).join(':')
}

export function useIosMirrorPreview({
  active,
  enabled,
}: UseIosMirrorPreviewOptions) {
  const previewRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<IosMirrorPreviewState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!active || !enabled) {
      setState('idle')
      setError(null)
      void invoke('ios_stop_mirror_preview').catch(() => undefined)
      return
    }

    let disposed = false
    let syncing = false
    let pendingSync = false
    let pendingForce = false
    let scheduledForce = false
    let timer: number | undefined
    let lastKey: string | null = null
    const cleanups: Array<() => void> = []

    const sync = async (force = false) => {
      const element = previewRef.current
      if (!element || disposed) return
      if (syncing) {
        pendingSync = true
        pendingForce ||= force
        return
      }
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return

      syncing = true
      setState((current) => current === 'live' ? current : 'starting')
      try {
        const [scaleFactor, innerPosition, outerPosition] = await Promise.all([
          appWindow.scaleFactor(),
          appWindow.innerPosition(),
          appWindow.outerPosition(),
        ])
        const request: MirrorPreviewRequest = {
          offsetX: (innerPosition.x - outerPosition.x) / scaleFactor + rect.left,
          offsetY: (innerPosition.y - outerPosition.y) / scaleFactor + rect.top,
          width: rect.width,
          height: rect.height,
        }
        const nextKey = boundsKey(request)
        if (!force && lastKey === nextKey) return
        await invoke('ios_set_mirror_preview', { request })
        if (disposed) return
        lastKey = nextKey
        setState('live')
        setError(null)
      } catch (cause) {
        if (disposed) return
        setState('error')
        setError(String(cause).replace(/^Error:\s*/, ''))
      } finally {
        syncing = false
        if (pendingSync && !disposed) {
          const forceNextSync = pendingForce
          pendingSync = false
          pendingForce = false
          schedule(0, forceNextSync)
        }
      }
    }

    const schedule = (delay = 70, force = false) => {
      scheduledForce ||= force
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        const forceNextSync = scheduledForce
        scheduledForce = false
        void sync(forceNextSync)
      }, delay)
    }

    const observer = new ResizeObserver(() => schedule())
    if (previewRef.current) observer.observe(previewRef.current)
    cleanups.push(() => observer.disconnect())

    const onScroll = () => schedule()
    window.addEventListener('scroll', onScroll, true)
    cleanups.push(() => window.removeEventListener('scroll', onScroll, true))

    const keepWindowListener = (unlisten: () => void) => {
      if (disposed) {
        unlisten()
      } else {
        cleanups.push(unlisten)
      }
    }
    void appWindow.onMoved(() => schedule(20, true))
      .then(keepWindowListener)
      .catch(() => undefined)
    void appWindow.onResized(() => schedule())
      .then(keepWindowListener)
      .catch(() => undefined)
    void appWindow.onFocusChanged(() => schedule(20, true))
      .then(keepWindowListener)
      .catch(() => undefined)

    const healthTimer = window.setInterval(() => void sync(true), 4000)
    cleanups.push(() => window.clearInterval(healthTimer))

    schedule(0, true)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      for (const cleanup of cleanups) cleanup()
      void invoke('ios_stop_mirror_preview').catch(() => undefined)
    }
  }, [active, enabled, revision])

  return {
    previewRef,
    previewState: state,
    previewError: error,
    refreshPreview: () => setRevision((value) => value + 1),
  }
}
