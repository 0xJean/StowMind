import { invoke } from '@tauri-apps/api/tauri'

// StowMind supplement app update scanning.
//
// Mole has not exposed App Store / Sparkle / Electron update scanning through
// CLI / JSON yet. This adapter calls the isolated StowMind supplement command
// and keeps the source label explicit so UI never presents it as Mole-native.

export const STOWMIND_SUPPLEMENT_SOURCE = 'stowmind_supplement'

export interface StowmindSupplementAppUpdateItem {
  name: string
  path: string
  bundleId?: string | null
  installedVersion?: string | null
  latestVersion?: string | null
  provider: string
  updateStatus: string
  confidence: string
  feedUrl?: string | null
  detail: string
  actionKind?: string | null
  actionTarget?: string | null
  actionLabel?: string | null
}

export interface StowmindSupplementAppUpdateScan {
  source: typeof STOWMIND_SUPPLEMENT_SOURCE
  operation: 'app_update_scan'
  platform: string
  generatedAtEpoch: number
  scanStatus: string
  message: string
  directories: string[]
  scannedApps: number
  updateCandidates: number
  appStoreApps: number
  sparkleApps: number
  electronApps: number
  items: StowmindSupplementAppUpdateItem[]
}

export function scanStowmindSupplementAppUpdates() {
  return invoke<StowmindSupplementAppUpdateScan>('stowmind_supplement_app_update_scan')
}

export interface StowmindAppUpdateActionOutput {
  action: string
  target: string
  success: boolean
  rawOutput: string
}

export function runStowmindSupplementAppUpdateAction(
  actionKind: string,
  actionTarget: string,
) {
  return invoke<StowmindAppUpdateActionOutput>('stowmind_supplement_app_update_action', {
    actionKind,
    actionTarget,
  })
}

export function sortAppUpdateItems(items: StowmindSupplementAppUpdateItem[]) {
  const rank: Record<string, number> = {
    available: 0,
    blocked: 1,
    checking: 2,
    unknown: 3,
    current: 4,
  }
  return [...items].sort((a, b) => {
    const statusDelta = (rank[a.updateStatus] ?? 9) - (rank[b.updateStatus] ?? 9)
    if (statusDelta !== 0) return statusDelta
    return a.name.localeCompare(b.name)
  })
}
