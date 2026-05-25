import { useEffect, useState } from 'react'

export function useMaintenanceScanProgress(loading: boolean) {
  const [scanElapsedMs, setScanElapsedMs] = useState(0)

  useEffect(() => {
    if (!loading) return

    const startedAt = Date.now()
    setScanElapsedMs(0)

    const interval = window.setInterval(() => {
      setScanElapsedMs(Date.now() - startedAt)
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [loading])

  return scanElapsedMs
}
