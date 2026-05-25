// StowMind supplement for Analyze delete.
//
// This calls a StowMind-owned backend adapter because Mole does not currently
// expose a safe Analyze delete CLI / JSON API. UI copy must present this as a
// supplement, not as a Mole-native delete operation.

import { invoke } from '@tauri-apps/api/tauri'

export interface StowmindSupplementTrashResult {
  source: 'stowmind_supplement'
  operation: 'move_to_trash'
  original_path: string
  trash_path: string | null
  message: string
}

export function movePathToTrashWithStowMindSupplement(path: string) {
  return invoke<StowmindSupplementTrashResult>('stowmind_supplement_move_to_trash', { path })
}
