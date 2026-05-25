import type { MoleStatusRaw } from '../status/advancedTypes'

const HUD_STATUS_CACHE_KEY = 'stowmind.hud.status.v1'
const HUD_STATUS_CACHE_SCHEMA_VERSION = 1

export interface HudStatusCacheSnapshot {
  schemaVersion: number
  updatedAt: string
  data: MoleStatusRaw
}

function isStatusData(value: unknown): value is MoleStatusRaw {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.collected_at === 'string' &&
    typeof record.health_score === 'number' &&
    typeof record.cpu === 'object' &&
    typeof record.memory === 'object'
  )
}

function normalizeHudStatusCache(value: unknown): HudStatusCacheSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<HudStatusCacheSnapshot>
  if (record.schemaVersion !== HUD_STATUS_CACHE_SCHEMA_VERSION) return null
  if (typeof record.updatedAt !== 'string') return null
  if (!isStatusData(record.data)) return null
  return {
    schemaVersion: HUD_STATUS_CACHE_SCHEMA_VERSION,
    updatedAt: record.updatedAt,
    data: record.data,
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
