import { invoke } from '@tauri-apps/api/tauri'

export const RESULT_CACHE_SCHEMA_VERSION = 1
const RESULT_CACHE_PATH_TOKEN_MAX = 180

export interface ResultCacheSnapshot<T> {
  key: string
  schemaVersion: number
  updatedAt: string
  payload: T
}

export const resultCacheKeys = {
  cleanPreview: 'mole.clean.preview',
  doctor: 'mole.doctor',
  installerPreview: 'mole.installer.preview',
  moleMapCompat: 'mole.map.compat',
  optimizeHealth: 'mole.optimize.health',
  appManagement: 'mole.app-management.v2',
  softwareUpdate: 'mole.software-update',
  statusRaw: 'mole.status.raw',
  analyze: (path: string) => `mole.analyze:${pathKey(path)}`,
  moleConsole: (command: string) => `mole.console:${tokenKey(command)}`,
  purgePreview: (path: string) => `mole.purge.preview:${pathKey(path)}`,
}

export function normalizeResultCachePath(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export async function loadResultSnapshot<T>(
  key: string,
  schemaVersion = RESULT_CACHE_SCHEMA_VERSION
) {
  try {
    const snapshot = await invoke<ResultCacheSnapshot<T> | null>('result_cache_load', { key })
    if (!snapshot || snapshot.schemaVersion !== schemaVersion) return null
    return snapshot
  } catch {
    return null
  }
}

export async function saveResultSnapshot<T>(
  key: string,
  payload: T,
  schemaVersion = RESULT_CACHE_SCHEMA_VERSION
) {
  try {
    await invoke('result_cache_save', {
      snapshot: {
        key,
        schemaVersion,
        updatedAt: new Date().toISOString(),
        payload,
      },
    })
  } catch {
    // Result caching is best-effort; Mole-backed operations remain authoritative.
  }
}

export async function deleteResultSnapshot(key: string) {
  try {
    await invoke('result_cache_delete', { key })
  } catch {
    // Cache invalidation should not block destructive Mole actions.
  }
}

export function formatResultSnapshotAge(updatedAt: string) {
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / (24 * 60))}d`
}

function pathKey(path: string) {
  const normalized = normalizeResultCachePath(path)
  return tokenKey(normalized)
}

function tokenKey(value: string) {
  const normalized = value.trim().toLowerCase()
  const encoded = encodeURIComponent(normalized)
  return encoded.length > RESULT_CACHE_PATH_TOKEN_MAX
    ? `${encoded.slice(0, RESULT_CACHE_PATH_TOKEN_MAX)}:${hashString(normalized)}`
    : encoded
}

function hashString(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}
