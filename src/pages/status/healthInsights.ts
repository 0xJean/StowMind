import { formatFileSize } from '@/lib/utils'
import type { MoleStatusRaw } from './advancedTypes'
import type { DiagnosticLevel, MoleDisk, MoleProcess } from './types'

type Translate = (key: any, vars?: Record<string, string | number>) => string

export interface HealthInsight {
  id: string
  title: string
  detail: string
  level: DiagnosticLevel
}

function scoreLevel(score: number): DiagnosticLevel {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'destructive'
}

function pressureLevel(value: number, warning = 80, destructive = 92): DiagnosticLevel {
  if (value >= destructive) return 'destructive'
  if (value >= warning) return 'warning'
  return 'success'
}

export function buildHealthInsights(
  data: MoleStatusRaw,
  primaryDisk: MoleDisk | null,
  topProcess: MoleProcess | undefined,
  t: Translate
): HealthInsight[] {
  const insights: HealthInsight[] = [
    {
      id: 'score',
      title: t('status.health.scoreTitle'),
      detail: t('status.health.scoreDetail', {
        score: data.health_score,
        message: data.health_score_msg || t('status.health.noMessage'),
      }),
      level: scoreLevel(data.health_score),
    },
    {
      id: 'cpu',
      title: t('status.health.cpuTitle'),
      detail: t('status.health.cpuDetail', {
        usage: Math.round(data.cpu.usage),
        load: data.cpu.load1.toFixed(2),
      }),
      level: pressureLevel(data.cpu.usage, 80, 92),
    },
    {
      id: 'memory',
      title: t('status.health.memoryTitle'),
      detail: t('status.health.memoryDetail', {
        usage: Math.round(data.memory.used_percent),
        pressure: data.memory.pressure || t('status.health.noMessage'),
      }),
      level: pressureLevel(data.memory.used_percent, 82, 92),
    },
  ]

  if (primaryDisk) {
    insights.push({
      id: 'disk',
      title: t('status.health.diskTitle'),
      detail: t('status.health.diskDetail', {
        mount: primaryDisk.mount,
        usage: Math.round(primaryDisk.used_percent),
        free: formatFileSize(primaryDisk.total - primaryDisk.used),
      }),
      level: pressureLevel(primaryDisk.used_percent, 82, 92),
    })
  }

  if (data.trash_size > 0) {
    insights.push({
      id: 'trash',
      title: t('status.health.trashTitle'),
      detail: t('status.health.trashDetail', { size: formatFileSize(data.trash_size) }),
      level: data.trash_size >= 1024 ** 3 ? 'warning' : 'success',
    })
  }

  if (topProcess) {
    insights.push({
      id: 'process',
      title: t('status.health.processTitle'),
      detail: t('status.health.processDetail', {
        name: topProcess.name,
        cpu: Math.round(topProcess.cpu),
        memory: Math.round(topProcess.memory),
      }),
      level: topProcess.cpu >= 80 || topProcess.memory >= 35 ? 'warning' : 'success',
    })
  }

  if (data.proxy?.enabled) {
    insights.push({
      id: 'proxy',
      title: t('status.health.proxyTitle'),
      detail: t('status.health.proxyDetail', {
        type: data.proxy.type || 'proxy',
        host: data.proxy.host || t('status.health.noMessage'),
      }),
      level: 'warning',
    })
  }

  if (data.process_alerts?.length) {
    insights.push({
      id: 'alerts',
      title: t('status.health.alertTitle'),
      detail: t('status.health.alertDetail', { count: data.process_alerts.length }),
      level: 'warning',
    })
  }

  return insights
}
