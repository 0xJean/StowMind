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
const alertSentAt = new Map<string, number>()
let permissionState: boolean | null = null
let permissionCheckedAt = 0
let permissionRequest: Promise<boolean> | null = null

function alertCpuValue(alert: MoleProcessAlert | null | undefined) {
  return typeof alert?.cpu === 'number' && Number.isFinite(alert.cpu) ? alert.cpu : 0
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
  const moleAlerts = Array.isArray(data?.process_alerts)
    ? data.process_alerts.filter((alert): alert is MoleProcessAlert => Boolean(alert && typeof alert === 'object'))
    : []
  const moleAlert = moleAlerts.find((alert) => alertCpuValue(alert) >= 80 || alert.severity === 'warning')
  if (moleAlert) {
    const cpu = alertCpuValue(moleAlert)
    const processName = moleAlert.name || alertTitle(moleAlert, t)
    const severity = cpu >= 90 || moleAlert.severity === 'destructive' ? 'destructive' : 'warning'
    return {
      // Do not include the rounded CPU value: a process fluctuating between
      // 85% and 86% should remain one alert and respect the cooldown.
      id: `${processName}-${moleAlert.pid ?? 'mole'}-${severity}`,
      title: alertTitle(moleAlert, t),
      detail: alertDetail(moleAlert, t),
      severity,
      processName,
      cpu,
    }
  }

  const topProcess = [...(data?.top_processes ?? [])]
    .filter((process): process is MoleProcess => Boolean(process && typeof process === 'object'))
    .sort((a, b) => processCpuValue(b) - processCpuValue(a))[0]
  const cpu = processCpuValue(topProcess)
  if (!topProcess || cpu < 85) return null

  return {
    id: `${topProcess.name}-${topProcess.pid}-top`,
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
  for (const [alertId, sentAt] of alertSentAt) {
    if (now - sentAt >= ALERT_COOLDOWN_MS) alertSentAt.delete(alertId)
  }
  const lastSentAt = alertSentAt.get(alert.id) ?? 0
  if (now - lastSentAt < ALERT_COOLDOWN_MS) return

  try {
    const allowed = await notificationPermission(now)
    if (!allowed) return

    await sendNotification({
      title: t('hud.alert.notificationTitle'),
      body: `${alert.title}: ${alert.detail}`,
    })
    alertSentAt.set(alert.id, now)
  } catch {
    // Notification permission or the native bridge must never turn a valid
    // status sample into a failed monitor refresh.
  }
}

async function notificationPermission(now: number): Promise<boolean> {
  if (permissionRequest) return permissionRequest
  if (permissionState !== null && now - permissionCheckedAt < ALERT_COOLDOWN_MS) return permissionState
  permissionRequest = (async () => {
    try {
      let allowed = await isPermissionGranted()
      if (!allowed) {
        const permission = await requestPermission()
        allowed = permission === 'granted'
      }
      permissionState = allowed
      permissionCheckedAt = Date.now()
      return allowed
    } catch {
      permissionState = false
      permissionCheckedAt = Date.now()
      return false
    } finally {
      permissionRequest = null
    }
  })()
  return permissionRequest
}
