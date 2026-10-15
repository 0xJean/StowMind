import { invoke } from '@tauri-apps/api/tauri'
import { useEffect, useRef } from 'react'

/**
 * Reserve the Rust-side iPhone organizer gate only while this route is active.
 * A monotonically increasing generation makes a late cleanup unable to
 * deactivate a newer page instance.
 */
export function useIosOrganizerLifecycle(active: boolean) {
  const generationRef = useRef(0)

  useEffect(() => {
    if (!active) return

    const activationGeneration = ++generationRef.current
    void invoke('ios_set_organizer_active', {
      active: true,
      generation: activationGeneration,
    }).catch(() => undefined)

    return () => {
      const deactivationGeneration = ++generationRef.current
      void invoke('ios_set_organizer_active', {
        active: false,
        generation: deactivationGeneration,
      }).catch(() => undefined)
    }
  }, [active])
}
