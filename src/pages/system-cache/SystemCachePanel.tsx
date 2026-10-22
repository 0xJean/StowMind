import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { SystemCacheCard } from './SystemCacheCard'
import { useSystemCache } from './useSystemCache'

export function SystemCachePanel() {
  const active = useLocation().pathname === '/doctor'
  const cache = useSystemCache(active)

  useEffect(() => {
    if (active) void cache.scan()
    // A fresh scan invalidates old authorization when returning to this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return <SystemCacheCard cache={cache} active={active} />
}
