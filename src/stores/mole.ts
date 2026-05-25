import type { MoleInstallationStatus } from '@/lib/mole'
import { create } from 'zustand'

export type MoleStatus = MoleInstallationStatus

interface MoleUpdateStatus {
  checked: boolean
  checking: boolean
  available: boolean
  message: string | null
  checkedAt: string | null
  error: string | null
}

interface MoleUpdatePayload {
  updateAvailable: boolean
  updateMessage?: string | null
  checkedAt?: string | null
}

interface MoleState {
  status: MoleStatus | null
  checked: boolean
  update: MoleUpdateStatus
  startStatusCheck: () => void
  setStatus: (status: MoleStatus) => void
  setUpdateChecking: () => void
  setUpdateResult: (payload: MoleUpdatePayload) => void
  setUpdateError: (error: string | null) => void
  clearUpdate: () => void
}

const emptyUpdate = (): MoleUpdateStatus => ({
  checked: false,
  checking: false,
  available: false,
  message: null,
  checkedAt: null,
  error: null,
})

export const useMoleStore = create<MoleState>()((set) => ({
  status: null,
  checked: false,
  update: emptyUpdate(),
  startStatusCheck: () => set({ checked: false }),
  setStatus: (status) =>
    set((state) => ({
      status,
      checked: true,
      update: status.installed ? state.update : emptyUpdate(),
    })),
  setUpdateChecking: () =>
    set((state) => ({
      update: {
        ...state.update,
        checking: true,
        error: null,
      },
    })),
  setUpdateResult: (payload) =>
    set({
      update: {
        checked: true,
        checking: false,
        available: payload.updateAvailable,
        message: payload.updateMessage ?? null,
        checkedAt: payload.checkedAt ?? new Date().toISOString(),
        error: null,
      },
    }),
  setUpdateError: (error) =>
    set((state) => ({
      update: {
        ...state.update,
        checked: true,
        checking: false,
        error,
      },
    })),
  clearUpdate: () => set({ update: emptyUpdate() }),
}))
