import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/api/notification'
import type { MoleProcessAlert, MoleStatusRaw } from '@/pages/status/advancedTypes'
import type { MoleProcess } from '@/pages/status/types'

type Translate = (key: any, vars?: Record<string, string | number>) => string

export interface HudCpuAlert {
  id: string
  title: string
  detail: string
  severity: 'warning' | 'destructive'
  processName: string
  cpu: number
}

const ALERT_COOLDOWN_MS = 5 * 60 * 1000
let lastAlertAt = 0
let lastAlertId = ''

function alertCpuValue(alert: MoleProcessAlert) {
  return typeof alert.cpu === 'number' && Number.isFinite(alert.cpu) ? alert.cpu : 0
}

function processCpuValue(process: MoleProcess | undefined) {
  return typeof process?.cpu === 'number' && Number.isFinite(process.cpu) ? process.cpu : 0
}

function alertTitle(alert: MoleProcessAlert, t: Translate) {
  return alert.title || alert.name || t('hud.alert.cpuTitle')
}

function alertDetail(alert: MoleProcessAlert, t: Translate) {
  if (alert.detail || alert.message) return alert.detail || alert.message || ''
  return t('hud.alert.cpuDetail', {
    name: alert.name || t('hud.alert.unknownProcess'),
    cpu: Math.round(alertCpuValue(alert)),
  })
}

export function buildHudCpuAlert(data: MoleStatusRaw | null, t: Translate): HudCpuAlert | null {
  const moleAlert = data?.process_alerts?.find((alert) => alertCpuValue(alert) >= 80 || alert.severity === 'warning')
  if (moleAlert) {
    const cpu = alertCpuValue(moleAlert)
    const processName = moleAlert.name || alertTitle(moleAlert, t)
    return {
      id: `${processName}-${Math.round(cpu)}-${moleAlert.pid ?? 'mole'}`,
      title: alertTitle(moleAlert, t),
      detail: alertDetail(moleAlert, t),
      severity: cpu >= 90 || moleAlert.severity === 'destructive' ? 'destructive' : 'warning',
      processName,
      cpu,
    }
  }

  const topProcess = [...(data?.top_processes ?? [])].sort((a, b) => b.cpu - a.cpu)[0]
  const cpu = processCpuValue(topProcess)
  if (!topProcess || cpu < 85) return null

  return {
    id: `${topProcess.name}-${Math.round(cpu)}-${topProcess.pid}`,
    title: t('hud.alert.cpuTitle'),
    detail: t('hud.alert.cpuDetail', { name: topProcess.name, cpu: Math.round(cpu) }),
    severity: cpu >= 95 ? 'destructive' : 'warning',
    processName: topProcess.name,
    cpu,
  }
}

export async function notifyHudCpuAlert(alert: HudCpuAlert | null, enabled: boolean, t: Translate) {
  if (!enabled || !alert) return

  const now = Date.now()
  if (alert.id === lastAlertId && now - lastAlertAt < ALERT_COOLDOWN_MS) return

  let allowed = await isPermissionGranted()
  if (!allowed) {
    const permission = await requestPermission()
    allowed = permission === 'granted'
  }
  if (!allowed) return

  sendNotification({
    title: t('hud.alert.notificationTitle'),
    body: `${alert.title}: ${alert.detail}`,
  })
  lastAlertAt = now
  lastAlertId = alert.id
}
