import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getIosCapabilities,
  type IosDeviceCapabilities,
} from '@/lib/ios'

export function useIosCapabilities(active: boolean) {
  const [capabilities, setCapabilities] = useState<IosDeviceCapabilities | null>(null)
  const [capabilityError, setCapabilityError] = useState<string | null>(null)
  const refreshInFlightRef = useRef(false)

  const canScan = capabilities?.scanReady ?? false
  const canExecute = capabilities?.executionReady ?? false

  const refreshCapabilities = useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    try {
      const result = await getIosCapabilities()
      setCapabilities(result)
      setCapabilityError(null)
    } catch (cause) {
      setCapabilityError(String(cause))
    } finally {
      refreshInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void refreshCapabilities()
    const timer = window.setInterval(
      () => void refreshCapabilities(),
      capabilities?.mirrorContentReady ? 4_000 : 1_800
    )
    return () => window.clearInterval(timer)
  }, [active, capabilities?.mirrorContentReady, refreshCapabilities])

  return {
    capabilities,
    capabilityError,
    canScan,
    canExecute,
    refreshCapabilities,
  }
}
