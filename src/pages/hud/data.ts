import type { HistoryRecord } from '@/stores/app'
import type { MoleStatusRaw } from '../status/advancedTypes'
import { findPrimaryNetwork } from '../status/diagnostics'

export interface HudHistory {
  cpu: number[]
  memory: number[]
  networkRx: number[]
  networkTx: number[]
  diskRead: number[]
  diskWrite: number[]
}

export const EMPTY_HUD_HISTORY: HudHistory = {
  cpu: [],
  memory: [],
  networkRx: [],
  networkTx: [],
  diskRead: [],
  diskWrite: [],
}

function appendSample(values: number[], value: number | undefined) {
  return [...values, Number.isFinite(value) ? Number(value) : 0].slice(-24)
}

export function appendHudHistory(current: HudHistory, data: MoleStatusRaw): HudHistory {
  const primaryNetwork = findPrimaryNetwork(data.network)
  return {
    cpu: appendSample(current.cpu, data.cpu.usage),
    memory: appendSample(current.memory, data.memory.used_percent),
    networkRx: appendSample(current.networkRx, primaryNetwork?.rx_rate_mbs),
    networkTx: appendSample(current.networkTx, primaryNetwork?.tx_rate_mbs),
    diskRead: appendSample(current.diskRead, data.disk_io.read_rate),
    diskWrite: appendSample(current.diskWrite, data.disk_io.write_rate),
  }
}

export function summarizeCleanupHistory(history: HistoryRecord[]) {
  const cleanup = history.filter((record) =>
    ['clean', 'purge', 'installer', 'uninstall', 'optimize'].includes(record.type ?? 'organize')
  )
  const executed = cleanup.filter((record) => record.executed)
  return {
    cleaned: executed.reduce((sum, record) => sum + (record.cleanupSummary?.totalSize ?? 0), 0),
    scans: cleanup.length,
    optimized: cleanup.filter((record) => record.type === 'optimize').length,
  }
}
