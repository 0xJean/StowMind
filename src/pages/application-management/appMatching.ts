import type { StowmindSupplementAppUpdateItem } from '@/lib/stowmind-supplements/appUpdates'
import type { ManagedAppRow, MoleUninstallItem, SortMode } from './types'

export function buildManagedRows(
  apps: MoleUninstallItem[],
  updates: StowmindSupplementAppUpdateItem[]
): ManagedAppRow[] {
  const updatesByPath = new Map(updates.map((item) => [normalizePath(item.path), item]))
  const updatesByBundle = new Map(
    updates
      .filter((item) => item.bundleId)
      .map((item) => [String(item.bundleId).toLowerCase(), item])
  )
  const updatesByName = new Map(updates.map((item) => [normalizeName(item.name), item]))

  return apps.map((app) => ({
    uninstall: app,
    update:
      updatesByPath.get(normalizePath(app.path)) ??
      updatesByBundle.get(app.bundle_id.toLowerCase()) ??
      updatesByName.get(normalizeName(app.name)),
  }))
}

export function filterManagedRows(
  rows: ManagedAppRow[],
  query: string,
  source: string,
  tab: string,
  sortMode: SortMode
) {
  const needle = query.trim().toLowerCase()
  return [...rows]
    .filter((row) => {
      const item = row.uninstall
      if (source !== 'all' && item.source !== source) return false
      if (tab === 'updates' && row.update?.updateStatus !== 'available') return false
      if (!needle) return true
      return [
        item.name,
        item.bundle_id,
        item.source,
        item.uninstall_name,
        item.path,
        item.size,
        row.update?.provider,
        row.update?.installedVersion,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    .sort((a, b) => compareRows(a, b, sortMode))
}

function compareRows(a: ManagedAppRow, b: ManagedAppRow, sortMode: SortMode) {
  if (sortMode === 'size_asc') return a.uninstall.size_bytes - b.uninstall.size_bytes
  if (sortMode === 'name') return a.uninstall.name.localeCompare(b.uninstall.name)
  if (sortMode === 'source') {
    return a.uninstall.source.localeCompare(b.uninstall.source) || a.uninstall.name.localeCompare(b.uninstall.name)
  }
  if (sortMode === 'update') {
    return updateRank(a.update?.updateStatus) - updateRank(b.update?.updateStatus) || a.uninstall.name.localeCompare(b.uninstall.name)
  }
  return b.uninstall.size_bytes - a.uninstall.size_bytes
}

function updateRank(status?: string) {
  if (status === 'available') return 0
  if (status === 'checking') return 1
  if (status === 'unknown') return 2
  if (status === 'current') return 3
  return 9
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function normalizeName(name: string) {
  return name.trim().replace(/\.app$/i, '').toLowerCase()
}
