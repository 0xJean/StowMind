export interface MoleInstallerItem {
  path: string
  name: string
  size: number
  source: string
}

export interface MoleInstallerPreview {
  items: MoleInstallerItem[]
  total_size: number
  scan_status?: 'complete'
  review_token?: string | null
}

export interface MoleInstallerExecuteOutcome {
  item_count: number | null
  total_size: number | null
  failed_count: number | null
  status: 'success' | 'partial' | 'failed' | 'unknown'
  raw_output: string
}

export function canExecuteInstallerPreview(preview: MoleInstallerPreview | null): boolean {
  return Boolean(preview && preview.scan_status === 'complete' && preview.review_token
    && preview.items.length > 0 && Number.isFinite(preview.total_size) && preview.total_size >= 0
    && preview.items.every((item) => item.path && Number.isFinite(item.size) && item.size >= 0))
}

/** A persisted preview is for reference; native review authority never survives reload. */
export function cachedInstallerPreview(preview: MoleInstallerPreview): MoleInstallerPreview {
  return { ...preview, review_token: null }
}
