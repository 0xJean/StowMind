import {
  deleteResultSnapshot,
  loadResultSnapshot,
  resultCacheKeys,
  saveResultSnapshot,
} from '@/lib/resultCache'
import type { MoleCleanPreview } from './types'

export interface PendingCleanScanSnapshot {
  id: string
  createdAt: string
  updatedAt: string
  status: 'pending'
  preview: MoleCleanPreview
}

export function hasCleanPreviewContent(preview: MoleCleanPreview) {
  return preview.item_count > 0 || preview.potential_space > 0 || preview.sections.some((section) => section.items.length > 0)
}

export async function loadPendingCleanScan() {
  const snapshot = await loadResultSnapshot<PendingCleanScanSnapshot>(resultCacheKeys.cleanPreview)
  if (!snapshot || !isPendingCleanScanSnapshot(snapshot.payload)) return null
  return snapshot.payload
}

export async function savePendingCleanScan(preview: MoleCleanPreview) {
  const now = new Date().toISOString()
  const snapshot: PendingCleanScanSnapshot = {
    id: `clean-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    preview,
  }

  await saveResultSnapshot(resultCacheKeys.cleanPreview, snapshot)
  return snapshot
}

export async function clearPendingCleanScan(id?: string) {
  if (id) {
    const current = await loadPendingCleanScan()
    if (current?.id !== id) return
  }
  await deleteResultSnapshot(resultCacheKeys.cleanPreview)
}

function isPendingCleanScanSnapshot(value: unknown): value is PendingCleanScanSnapshot {
  if (!isRecord(value)) return false
  const status = value.status
  return (
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    status === 'pending' &&
    isMoleCleanPreview(value.preview)
  )
}

function isMoleCleanPreview(value: unknown): value is MoleCleanPreview {
  if (!isRecord(value)) return false
  return (
    typeof value.potential_space === 'number' &&
    typeof value.item_count === 'number' &&
    typeof value.category_count === 'number' &&
    Array.isArray(value.sections) &&
    typeof value.raw_output === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
