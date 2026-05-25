export interface MoleAnalyzeEntry {
  name: string
  path: string
  size: number
  is_dir: boolean
  last_access?: string
}

export interface MoleAnalyzeResult {
  path: string
  overview?: boolean
  entries: MoleAnalyzeEntry[]
  large_files?: MoleAnalyzeEntry[]
  warnings?: string[]
  total_size: number
  total_files: number
}

export interface MoleAnalyzeProgress {
  runId: string
  path: string
  phase: string
  stream?: string | null
  line?: string | null
  elapsedSecs: number
  current?: number | null
  total?: number | null
}

export interface MoleAnalyzePartial {
  runId: string
  result: MoleAnalyzeResult
}

export interface TreemapRect {
  entry: MoleAnalyzeEntry
  x: number
  y: number
  width: number
  height: number
  depth: number
}

export const ANALYZE_ENTRY_LIMIT = 1500
export const ANALYZE_LARGE_FILE_LIMIT = 100

export function compactAnalyzeResult(result: MoleAnalyzeResult): MoleAnalyzeResult {
  const entries = result.entries.length > ANALYZE_ENTRY_LIMIT
    ? [...result.entries].sort((a, b) => b.size - a.size).slice(0, ANALYZE_ENTRY_LIMIT)
    : result.entries

  const largeFiles = result.large_files && result.large_files.length > ANALYZE_LARGE_FILE_LIMIT
    ? [...result.large_files].sort((a, b) => b.size - a.size).slice(0, ANALYZE_LARGE_FILE_LIMIT)
    : result.large_files

  if (entries === result.entries && largeFiles === result.large_files) return result

  return {
    ...result,
    overview: result.overview || entries.length !== result.entries.length,
    entries,
    large_files: largeFiles,
  }
}
