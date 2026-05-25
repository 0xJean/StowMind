import {
  formatResultSnapshotAge,
  loadResultSnapshot,
  resultCacheKeys,
  saveResultSnapshot,
} from '@/lib/resultCache'
import { compactAnalyzeResult, type MoleAnalyzeResult } from './types'

export const ANALYZE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ANALYZE_PARTIAL_SAVE_DELAY_MS = 1200

export interface CachedAnalyzeResult {
  path: string
  createdAt: number
  result: MoleAnalyzeResult
}

export async function getCachedAnalyze(path: string) {
  const snapshot = await loadResultSnapshot<CachedAnalyzeResult>(resultCacheKeys.analyze(path))
  if (!snapshot) return null
  const createdAt = snapshot.payload.createdAt || Date.parse(snapshot.updatedAt)
  if (Date.now() - createdAt > ANALYZE_CACHE_TTL_MS) return null
  return { ...snapshot.payload, createdAt, result: compactAnalyzeResult(snapshot.payload.result) }
}

export async function getSavedAnalyze(path: string) {
  const snapshot = await loadResultSnapshot<CachedAnalyzeResult>(resultCacheKeys.analyze(path))
  if (!snapshot) return null
  const createdAt = snapshot.payload.createdAt || Date.parse(snapshot.updatedAt)
  return { ...snapshot.payload, createdAt, result: compactAnalyzeResult(snapshot.payload.result) }
}

export function setCachedAnalyze(path: string, result: MoleAnalyzeResult) {
  return saveResultSnapshot<CachedAnalyzeResult>(resultCacheKeys.analyze(path), {
    path,
    createdAt: Date.now(),
    result: compactAnalyzeResult(result),
  })
}

export function createAnalyzeCacheWriter() {
  let timer: ReturnType<typeof window.setTimeout> | null = null
  let pending: { path: string; result: MoleAnalyzeResult } | null = null
  let saving = Promise.resolve()

  const write = (path: string, result: MoleAnalyzeResult) => {
    saving = saving.catch(() => {}).then(() => setCachedAnalyze(path, result))
    return saving
  }

  const flush = async () => {
    const next = pending
    pending = null
    if (!next) return
    await write(next.path, next.result)
  }

  return {
    schedule(path: string, result: MoleAnalyzeResult) {
      pending = { path, result }
      if (timer) return
      timer = window.setTimeout(() => {
        timer = null
        void flush()
      }, ANALYZE_PARTIAL_SAVE_DELAY_MS)
    },
    async saveNow(path: string, result: MoleAnalyzeResult) {
      if (timer) {
        window.clearTimeout(timer)
        timer = null
      }
      pending = null
      await write(path, result)
    },
    dispose() {
      if (timer) {
        window.clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}

export function formatCacheAge(createdAt: number) {
  return formatResultSnapshotAge(new Date(createdAt).toISOString())
}
