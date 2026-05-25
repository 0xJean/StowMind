export interface DuplicateScanProgress {
  phase: 'collecting' | 'hashing' | 'finalizing'
  current: number
  total: number
}
