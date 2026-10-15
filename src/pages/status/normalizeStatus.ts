import type { MoleStatusRaw } from './advancedTypes'

/**
 * Mole omits collection data by returning null when the platform cannot provide
 * it (for example, network interfaces or process snapshots). Keep that detail
 * at the command boundary so the rest of the status UI can safely render an
 * empty state instead of crashing on `.map`, `.find`, or array indexing.
 */
export function normalizeStatus(value: unknown): MoleStatusRaw {
  if (!isRecord(value)) {
    throw new Error('Mole status returned an invalid response')
  }

  const requiredObjects = ['hardware', 'cpu', 'memory', 'disk_io']
  if (requiredObjects.some((key) => !isRecord(value[key]))) {
    throw new Error('Mole status response is missing required metrics')
  }

  return {
    ...value,
    hardware: value.hardware as MoleStatusRaw['hardware'],
    cpu: value.cpu as MoleStatusRaw['cpu'],
    memory: value.memory as MoleStatusRaw['memory'],
    disk_io: value.disk_io as MoleStatusRaw['disk_io'],
    disks: asObjectArray(value.disks),
    network: asObjectArray(value.network),
    batteries: asObjectArray(value.batteries),
    top_processes: asObjectArray(value.top_processes),
    gpu: asObjectArray(value.gpu),
    process_alerts: asObjectArray(value.process_alerts),
    bluetooth: asObjectArray(value.bluetooth),
    network_history: normalizeNetworkHistory(value.network_history),
  } as unknown as MoleStatusRaw
}

function asObjectArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function normalizeNetworkHistory(value: unknown) {
  if (!isRecord(value)) return undefined
  return {
    rx_history: asNumberArray(value.rx_history),
    tx_history: asNumberArray(value.tx_history),
  }
}

function asNumberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
