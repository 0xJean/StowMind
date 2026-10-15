import type { MoleStatusRaw } from '../status/advancedTypes'
import { normalizeStatus } from '../status/normalizeStatus'

const HUD_STATUS_CACHE_KEY = 'stowmind.hud.status.v1'
const HUD_STATUS_CACHE_SCHEMA_VERSION = 1

export interface HudStatusCacheSnapshot {
  schemaVersion: number
  updatedAt: string
  data: MoleStatusRaw
}

/**
 * Validate the untrusted JSON returned by Mole before it reaches the HUD tree.
 * A malformed response should show a retryable error instead of crashing while
 * rendering a nested field such as `memory.used` or `network[0].ip`.
 */
export function parseHudStatus(value: unknown): MoleStatusRaw {
  return normalizeStatus(value)
}

function normalizeHudStatusCache(value: unknown): HudStatusCacheSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<HudStatusCacheSnapshot>
  if (record.schemaVersion !== HUD_STATUS_CACHE_SCHEMA_VERSION) return null
  if (typeof record.updatedAt !== 'string') return null
  let data: MoleStatusRaw
  try {
    data = normalizeStatus(record.data)
  } catch {
    return null
  }
  return {
    schemaVersion: HUD_STATUS_CACHE_SCHEMA_VERSION,
    updatedAt: record.updatedAt,
    data,
  }
}

export function loadHudStatusCache() {
  try {
    const raw = localStorage.getItem(HUD_STATUS_CACHE_KEY)
    if (!raw) return null
    return normalizeHudStatusCache(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveHudStatusCache(data: MoleStatusRaw) {
  try {
    const snapshot: HudStatusCacheSnapshot = {
      schemaVersion: HUD_STATUS_CACHE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      data,
    }
    localStorage.setItem(HUD_STATUS_CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // HUD caching is best-effort. Live Mole status remains authoritative.
  }
}
