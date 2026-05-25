import { invoke } from '@tauri-apps/api/tauri'
import { formatFileSize } from '@/lib/utils'
import { findPrimaryDisk, findPrimaryNetwork } from '@/pages/status/diagnostics'
import { formatPercent, formatRate } from '@/pages/status/utils'
import type { MoleStatusMetrics } from '@/pages/status/types'
import type { HudMetricKey, HudSettings } from './settings'
import type { useI18n } from '@/i18n'

type Translate = ReturnType<typeof useI18n>['t']

interface HudTrayLabels {
  openHud: string
  openClean: string
  openUninstall: string
  openOptimize: string
  openAnalyze: string
  openStatus: string
  openOrganize: string
  openConsole: string
  openSettings: string
  quit: string
}

interface HudTrayConfig {
  labels: HudTrayLabels
  title: string
  tooltip: string
}

function metricLabel(metric: HudMetricKey, t: Translate) {
  return t(`hud.metric.${metric}` as Parameters<Translate>[0])
}

function metricShortLabel(metric: HudMetricKey, t: Translate) {
  return t(`hud.metricShort.${metric}` as Parameters<Translate>[0])
}

function compactRate(value: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  const text = value < 1 ? value.toFixed(2) : value < 10 ? value.toFixed(1) : value.toFixed(0)
  return text + 'M'
}

function metricValue(metric: HudMetricKey, data: MoleStatusMetrics | null, compact = false) {
  const primaryDisk = findPrimaryDisk(data?.disks)
  const primaryNetwork = findPrimaryNetwork(data?.network)
  const battery = data?.batteries?.[0]
  if (!data) return '...'

  switch (metric) {
    case 'cpu':
      return formatPercent(data.cpu.usage)
    case 'memory':
      return formatPercent(data.memory.used_percent)
    case 'network':
      return compact
        ? `↓${compactRate(primaryNetwork?.rx_rate_mbs)} ↑${compactRate(primaryNetwork?.tx_rate_mbs)}`
        : `${formatRate(primaryNetwork?.rx_rate_mbs)} / ${formatRate(primaryNetwork?.tx_rate_mbs)}`
    case 'disk':
      return formatPercent(primaryDisk?.used_percent)
    case 'battery':
      return battery ? formatPercent(battery.percent) : '-'
  }
}

function metricTitle(metric: HudMetricKey, data: MoleStatusMetrics | null, t: Translate) {
  return `${metricShortLabel(metric, t)} ${metricValue(metric, data, true)}`
}

function trayTitle(settings: HudSettings, data: MoleStatusMetrics | null, t: Translate, activityFrame: string) {
  if (settings.trayStyle === 'icon') return ''
  if (!data) return 'StowMind'
  const metrics = settings.visibleMetrics
    .slice(0, 3)
    .map((metric) => metricTitle(metric, data, t))
    .join('  ')
  return metrics || activityFrame || 'StowMind'
}

function trayTooltip(settings: HudSettings, data: MoleStatusMetrics | null, t: Translate) {
  const primaryDisk = findPrimaryDisk(data?.disks)
  const lines = [
    t('hud.title'),
    data ? t('hud.tray.health', { score: data.health_score, message: data.health_score_msg }) : t('hud.loading'),
    ...settings.visibleMetrics.map((metric) => `${metricLabel(metric, t)}: ${metricValue(metric, data)}`),
  ]

  if (primaryDisk) {
    lines.push(`${t('hud.metric.disk')}: ${primaryDisk.mount} ${formatFileSize(primaryDisk.used)} / ${formatFileSize(primaryDisk.total)}`)
  }
  return lines.join('\n')
}

export function buildHudTrayLabels(t: Translate): HudTrayLabels {
  return {
    openHud: t('hud.tray.openHud'),
    openClean: t('hud.tray.openClean'),
    openUninstall: t('hud.tray.openUninstall'),
    openOptimize: t('hud.tray.openOptimize'),
    openAnalyze: t('hud.tray.openAnalyze'),
    openStatus: t('hud.tray.openStatus'),
    openOrganize: t('hud.tray.openOrganize'),
    openConsole: t('hud.tray.openConsole'),
    openSettings: t('hud.tray.openSettings'),
    quit: t('hud.tray.quit'),
  }
}

export function buildHudTrayConfig(
  settings: HudSettings,
  data: MoleStatusMetrics | null,
  t: Translate,
  activityFrame = ''
): HudTrayConfig {
  return {
    labels: buildHudTrayLabels(t),
    title: trayTitle(settings, data, t, activityFrame),
    tooltip: trayTooltip(settings, data, t),
  }
}

export async function applyHudWindowMode(
  settings: HudSettings,
  options: { center?: boolean } = {}
) {
  await invoke('hud_apply_window_mode', {
    compact: settings.compact,
    alwaysOnTop: settings.alwaysOnTop,
    hideDockIcon: settings.hideDockIcon,
    center: options.center ?? false,
  })
}

export async function applyHudTraySettings(
  settings: HudSettings,
  data: MoleStatusMetrics | null,
  t: Translate,
  activityFrame = ''
) {
  await invoke('hud_apply_tray_config', {
    config: buildHudTrayConfig(settings, data, t, activityFrame),
  })
}

export async function applyHudNativeSettings(
  settings: HudSettings,
  data: MoleStatusMetrics | null,
  t: Translate,
  activityFrame = '',
  options: { center?: boolean } = {}
) {
  await applyHudWindowMode(settings, options)
  await applyHudTraySettings(settings, data, t, activityFrame)
}

export async function openHudPopover() {
  await invoke('hud_open_popover')
}
