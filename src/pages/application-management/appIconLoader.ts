import { invoke } from '@tauri-apps/api/tauri'
import { useEffect, useState } from 'react'

interface AppIconDataUrlResult {
  path: string
  iconDataUrl?: string | null
}

const BATCH_SIZE = 16
const MAX_ACTIVE_BATCHES = 2
const PREFETCH_LIMIT = 48
const FLUSH_DELAY_MS = 24
const WARM_CHUNK_SIZE = 32
const WARM_DELAY_MS = 800

const iconCache = new Map<string, string | null>()
const iconSubscribers = new Map<string, Set<(value: string | null) => void>>()
const iconQueue = new Set<string>()
const pendingIcons = new Set<string>()
const warmQueue = new Set<string>()
let activeBatches = 0
let flushTimer: number | null = null
let warmTimer: number | null = null

export function prefetchAppIcons(paths: string[]) {
  enqueueAppIcons(paths.slice(0, PREFETCH_LIMIT))
  warmAppIconCache(paths.slice(PREFETCH_LIMIT))
}

export function useAppIconDataUrl(
  path: string,
  fallbackIconDataUrl: string | null | undefined,
  enabled: boolean
) {
  const [iconDataUrl, setIconDataUrl] = useState(() => {
    if (fallbackIconDataUrl) return fallbackIconDataUrl
    return iconCache.get(path) ?? null
  })

  useEffect(() => {
    if (fallbackIconDataUrl) {
      setCachedIcon(path, fallbackIconDataUrl)
      setIconDataUrl(fallbackIconDataUrl)
      return
    }

    if (iconCache.has(path)) {
      setIconDataUrl(iconCache.get(path) ?? null)
    }

    const unsubscribe = subscribeIcon(path, setIconDataUrl)
    if (enabled) enqueueAppIcons([path])
    return unsubscribe
  }, [enabled, fallbackIconDataUrl, path])

  return iconDataUrl
}

function subscribeIcon(path: string, listener: (value: string | null) => void) {
  const listeners = iconSubscribers.get(path) ?? new Set<(value: string | null) => void>()
  listeners.add(listener)
  iconSubscribers.set(path, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) iconSubscribers.delete(path)
  }
}

function enqueueAppIcons(paths: string[]) {
  for (const path of paths) {
    if (!path || iconCache.has(path) || pendingIcons.has(path)) continue
    iconQueue.add(path)
  }
  scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushIconQueue()
  }, FLUSH_DELAY_MS)
}

function flushIconQueue() {
  while (activeBatches < MAX_ACTIVE_BATCHES && iconQueue.size > 0) {
    const paths = Array.from(iconQueue).slice(0, BATCH_SIZE)
    for (const path of paths) {
      iconQueue.delete(path)
      pendingIcons.add(path)
    }
    activeBatches += 1

    invoke<AppIconDataUrlResult[]>('app_icon_data_url_batch_json', { paths })
      .then((results) => {
        const byPath = new Map(results.map((result) => [result.path, result.iconDataUrl ?? null]))
        for (const path of paths) {
          setCachedIcon(path, byPath.get(path) ?? null)
        }
      })
      .catch(() => {
        for (const path of paths) {
          setCachedIcon(path, null)
        }
      })
      .finally(() => {
        for (const path of paths) pendingIcons.delete(path)
        activeBatches -= 1
        if (iconQueue.size > 0) flushIconQueue()
      })
  }
}

function warmAppIconCache(paths: string[]) {
  for (const path of paths) {
    if (!path || iconCache.has(path) || pendingIcons.has(path) || iconQueue.has(path)) continue
    warmQueue.add(path)
  }
  scheduleWarmFlush()
}

function scheduleWarmFlush() {
  if (warmTimer !== null || warmQueue.size === 0) return
  warmTimer = window.setTimeout(() => {
    warmTimer = null
    const paths = Array.from(warmQueue).slice(0, WARM_CHUNK_SIZE)
    for (const path of paths) warmQueue.delete(path)
    enqueueAppIcons(paths)
    scheduleWarmFlush()
  }, WARM_DELAY_MS)
}

function setCachedIcon(path: string, iconDataUrl: string | null) {
  iconCache.set(path, iconDataUrl)
  const listeners = iconSubscribers.get(path)
  if (!listeners) return
  for (const listener of listeners) listener(iconDataUrl)
}
