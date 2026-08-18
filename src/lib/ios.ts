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

export async function getIosCapabilities() {
  return invoke<IosDeviceCapabilities>('ios_capabilities')
}
