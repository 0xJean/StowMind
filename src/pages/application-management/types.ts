import type { StowmindSupplementAppUpdateItem } from '@/lib/stowmind-supplements/appUpdates'

export interface MoleUninstallItem {
  name: string
  bundle_id: string
  source: string
  uninstall_name: string
  path: string
  size: string
  size_bytes: number
  icon_data_url?: string | null
}

export interface MoleUninstallList {
  items: MoleUninstallItem[]
  total_size: number
}

export interface MoleUninstallOperationOutput {
  item_count: number
  total_size: number
  raw_output: string
}

export type SortMode = 'size_desc' | 'size_asc' | 'name' | 'source' | 'update'
export type AppManagementTab = 'all' | 'updates' | 'uninstall'

export interface ManagedAppRow {
  uninstall: MoleUninstallItem
  update?: StowmindSupplementAppUpdateItem
}
