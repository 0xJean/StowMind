import { formatFileSize } from '@/lib/utils'
import type { MoleDisk, MoleNetwork, MoleProcess, MoleStatusMetrics, DiagnosticItem } from './types'

export function buildDiagnostics<T extends (key: any, vars?: Record<string, string | number>) => string>(
  data: MoleStatusMetrics,
  primaryDisk: MoleDisk | null,
  topProcess: MoleProcess | undefined,
  t: T
) {
  const items: DiagnosticItem[] = []

  if (data.cpu.usage >= 85) {
    items.push({
      level: 'warning',
      title: t('status.diagnostic.cpuHigh'),
      detail: t('status.diagnostic.cpuHighDetail', { value: Math.round(data.cpu.usage) }),
    })
  }

  if (data.memory.used_percent >= 85) {
    items.push({
      level: 'warning',
      title: t('status.diagnostic.memoryHigh'),
      detail: t('status.diagnostic.memoryHighDetail', { value: Math.round(data.memory.used_percent) }),
    })
  }

  if (primaryDisk && primaryDisk.used_percent >= 85) {
    items.push({
      level: 'warning',
      title: t('status.diagnostic.diskHigh'),
      detail: t('status.diagnostic.diskHighDetail', {
        mount: primaryDisk.mount,
        value: Math.round(primaryDisk.used_percent),
      }),
    })
  }

  if (data.trash_size > 0) {
    items.push({
      level: data.trash_size >= 1024 ** 3 ? 'warning' : 'success',
      title: t('status.diagnostic.trashPresent'),
      detail: t('status.diagnostic.trashPresentDetail', { size: formatFileSize(data.trash_size) }),
    })
  }

  if (topProcess && (topProcess.cpu >= 35 || topProcess.memory >= 15)) {
    items.push({
      level: 'warning',
      title: t('status.diagnostic.processHot'),
      detail: t('status.diagnostic.processHotDetail', {
        name: topProcess.name,
        cpu: Math.round(topProcess.cpu),
        memory: Math.round(topProcess.memory),
      }),
    })
  }

  const lowBattery = data.batteries.find((battery) => battery.percent < 20)
  if (lowBattery) {
    items.push({
      level: 'warning',
      title: t('status.diagnostic.batteryLow'),
      detail: t('status.diagnostic.batteryLowDetail', {
        percent: Math.round(lowBattery.percent),
        status: lowBattery.status,
      }),
    })
  }

  if (items.length === 0) {
    items.push({
      level: severityFromScore(data.health_score),
      title: t('status.diagnostic.allClear'),
      detail: t('status.diagnostic.allClearDetail'),
    })
  }

  return items
}

export function severityFromScore(score: number): DiagnosticItem['level'] {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'destructive'
}

export function findPrimaryDisk(disks: MoleDisk[] | undefined) {
  if (!disks || disks.length === 0) return null
  return disks.find((disk) => disk.mount === '/' || disk.mount.endsWith(':')) ?? disks[0]
}

export function sortProcesses(processes: MoleProcess[] | undefined) {
  return [...(processes ?? [])].sort((a, b) => b.cpu - a.cpu || b.memory - a.memory || a.pid - b.pid)
}

export function findPrimaryNetwork(networks: MoleNetwork[] | undefined) {
  const items = networks ?? []
  if (items.length === 0) return null
  return [...items].sort((a, b) => networkScore(b) - networkScore(a))[0] ?? null
}

function networkScore(item: MoleNetwork) {
  const hasIp = item.ip.trim().length > 0 ? 1000 : 0
  const transfer = Math.max(0, item.rx_rate_mbs) + Math.max(0, item.tx_rate_mbs)
  return hasIp + transfer
}
