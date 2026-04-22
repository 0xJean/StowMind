import { create } from 'zustand'

export interface MoleStatus {
  installed: boolean
  version: string | null
  platform: 'macos' | 'windows' | 'linux'
}

interface DeepCleanState {
  moleStatus: MoleStatus | null
  moleChecked: boolean
  setMoleStatus: (status: MoleStatus) => void
}

/** Session-only store — not persisted to localStorage */
export const useDeepCleanStore = create<DeepCleanState>()((set) => ({
  moleStatus: null,
  moleChecked: false,
  setMoleStatus: (status) => set({ moleStatus: status, moleChecked: true }),
}))
