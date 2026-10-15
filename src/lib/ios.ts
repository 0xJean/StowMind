import { invoke } from '@tauri-apps/api/tauri'

export type IosMirrorConnectionState = 'ready' | 'paused' | 'blocked' | 'unavailable'

export interface IosDeviceCapabilities {
  platformSupported: boolean
  mirrorRunning: boolean
  mirrorContentReady: boolean
  mirrorConnectionState: IosMirrorConnectionState
  accessibilityGranted: boolean
  screenRecordingGranted: boolean
  helperAvailable: boolean
  scanReady: boolean
  executionReady: boolean
  debugBuild: boolean
  appBundlePath?: string
  message?: string
  executionMessage?: string
}

export interface IosAppIdentity {
  id: string
  name: string
  bundleId?: string
  category: string
  sensitive: boolean
  confidence: number
  source: string
  currentPage?: number
  currentRow?: number
  currentColumn?: number
  inDock: boolean
  folderName?: string
}

export interface IosFolderSnapshot {
  name: string
  page: number
  row: number
  column: number
  appIds: string[]
}

export interface IosPageSnapshot {
  index: number
  appIds: string[]
  hasWidgets: boolean
}

export interface IosWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface IosLayoutSnapshot {
  id: string
  capturedAt: string
  deviceName?: string
  apps: IosAppIdentity[]
  folders: IosFolderSnapshot[]
  pages: IosPageSnapshot[]
  dock: string[]
  inventoryHash: string
  layoutHash: string
  confidence: number
  source: string
  scanScope: string
  inventoryComplete: boolean
  warnings: string[]
  windowBounds?: IosWindowBounds
}

export type IosOperation =
  | {
      type: 'moveApp'
      appId: string
      fromPage: number
      fromRow: number
      fromColumn: number
      toPage: number
      toRow: number
      toColumn: number
    }
  | {
      type: 'createFolder'
      page: number
      row: number
      column: number
      name: string
      appIds: string[]
    }
  | {
      type: 'renameFolder'
      page: number
      row: number
      column: number
      from: string
      to: string
    }
  | {
      type: 'moveToDock'
      appId: string
      fromPage: number
      fromRow: number
      fromColumn: number
      dockIndex: number
    }

export interface IosLayoutPlan {
  id: string
  sourceSnapshotId: string
  template: string
  useAi: boolean
  operations: IosOperation[]
  targetLayoutHash?: string
  warnings: string[]
  protectedAppIds: string[]
  createdAt: string
  restoreTargetSnapshotId?: string
}

export type IosExecutionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface IosExecutionSession {
  id: string
  planId: string
  status: IosExecutionStatus
  currentIndex: number
  total: number
  error?: string
  guidanceMessage?: string
  guidanceCanResume?: boolean
  lastVerifiedSnapshotId?: string
  createdAt: string
  updatedAt: string
}

export interface IosProgressEvent {
  sessionId: string
  current: number
  total: number
  status: string
  message: string
}

export interface IosScanProgress {
  current: number
  total: number
  message: string
}

export function hasAllHomeScreenPages(snapshot: IosLayoutSnapshot | null | undefined) {
  if (
    !snapshot
    || !['homeScreenPages', 'homeScreenAndAppLibrary'].includes(snapshot.scanScope)
    || snapshot.pages.length === 0
  ) {
    return false
  }
  const pageIndices = [...new Set(snapshot.pages.map((page) => page.index))]
    .sort((left, right) => left - right)
  return pageIndices.length === snapshot.pages.length
    && pageIndices.every((pageIndex, position) => pageIndex === position)
}

/** A preserved App set is necessary, but only the planned layout proves success. */
export function getIosVerificationError(
  source: IosLayoutSnapshot | null,
  plan: IosLayoutPlan | null,
  session: IosExecutionSession | null,
  current: IosLayoutSnapshot,
  sourceStale = false,
) {
  if (!source || !plan || plan.sourceSnapshotId !== source.id
    || !session || session.planId !== plan.id || session.status !== 'completed'
    || session.total !== plan.operations.length || session.currentIndex !== session.total) {
    return sourceStale
      ? 'iosOrganize.visual.snapshotStale' as const
      : 'iosOrganize.error.verificationContext' as const
  }
  // A completed plan uses its source as historical evidence, not executable
  // coordinates. Leaving manual interaction must not prevent a fresh full scan
  // from verifying that immutable target, even though the source is now stale.
  if (plan.operations.length === 0) return 'iosOrganize.error.noOperations' as const
  if (!plan.targetLayoutHash?.trim()) return 'iosOrganize.error.verificationTarget' as const
  if (!hasAllHomeScreenPages(source) || !hasAllHomeScreenPages(current)) {
    return 'iosOrganize.error.verificationScope' as const
  }
  if (!source.inventoryHash || !current.inventoryHash
    || source.inventoryHash !== current.inventoryHash) {
    return 'iosOrganize.error.inventoryChanged' as const
  }
  if (!current.layoutHash || plan.targetLayoutHash !== current.layoutHash) {
    return 'iosOrganize.error.layoutChanged' as const
  }
  return null
}

export async function getIosCapabilities() {
  return invoke<IosDeviceCapabilities>('ios_capabilities')
}
