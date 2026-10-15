import { invoke } from '@tauri-apps/api/tauri'
import { useRef, useState } from 'react'
import type { IosLayoutSnapshot } from '@/lib/ios'

interface InventoryRun {
  cancelled: boolean
  started: boolean
}

/** A stop during preparation must also prevent the subsequent native scan. */
export function useIosInventory() {
  const [scanning, setScanning] = useState(false)
  const runRef = useRef<InventoryRun | null>(null)

  const runInventory = async (deviceName: string | null, prepare?: () => Promise<void>) => {
    if (runRef.current) return null
    const run: InventoryRun = { cancelled: false, started: false }
    runRef.current = run
    setScanning(true)
    try {
      await prepare?.()
      if (run.cancelled) return null
      run.started = true
      const snapshot = await invoke<IosLayoutSnapshot>('ios_scan_inventory', {
        request: { deviceName },
      })
      return run.cancelled ? null : snapshot
    } catch (cause) {
      if (run.cancelled) return null
      throw cause
    } finally {
      if (runRef.current === run) runRef.current = null
      setScanning(false)
    }
  }

  const cancelInventory = async () => {
    const run = runRef.current
    if (!run) return false
    // Preserve the user's intent even if the native stop fails. They may retry
    // stopping, but a late result can no longer become a usable inventory.
    run.cancelled = true
    if (!run.started) return true
    return invoke<boolean>('ios_cancel_inventory')
  }

  return { scanning, runInventory, cancelInventory }
}
