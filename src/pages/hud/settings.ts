export const HUD_SETTINGS_KEY = 'stowmind.hud.settings.v1'
export const DEFAULT_HUD_SHORTCUT = 'CmdOrCtrl+Shift+H'

export type HudMetricKey = 'cpu' | 'memory' | 'network' | 'disk' | 'battery'
export type HudTrayStyle = 'metrics' | 'icon'

export interface HudSettings {
  shortcut: string
  compact: boolean
  alwaysOnTop: boolean
  hideDockIcon: boolean
  cpuAlerts: boolean
  trayStyle: HudTrayStyle
  visibleMetrics: HudMetricKey[]
}

export const HUD_METRICS: HudMetricKey[] = ['cpu', 'memory', 'network', 'disk', 'battery']

export const DEFAULT_HUD_SETTINGS: HudSettings = {
  shortcut: DEFAULT_HUD_SHORTCUT,
  compact: true,
  alwaysOnTop: true,
  hideDockIcon: false,
  cpuAlerts: true,
  trayStyle: 'metrics',
  visibleMetrics: ['cpu', 'memory', 'network'],
}

function normalizeMetrics(value: unknown): HudMetricKey[] {
  if (!Array.isArray(value)) return DEFAULT_HUD_SETTINGS.visibleMetrics
  const next = value.filter((item): item is HudMetricKey => HUD_METRICS.includes(item as HudMetricKey))
  return next.length > 0 ? next : DEFAULT_HUD_SETTINGS.visibleMetrics
}

export function normalizeHudSettings(value: Partial<HudSettings> | null | undefined): HudSettings {
  const trayStyle = value?.trayStyle === 'icon' ? 'icon' : 'metrics'
  return {
    ...DEFAULT_HUD_SETTINGS,
    ...value,
    shortcut: value?.shortcut?.trim() || DEFAULT_HUD_SETTINGS.shortcut,
    trayStyle,
    visibleMetrics: normalizeMetrics(value?.visibleMetrics),
  }
}

export function loadHudSettings(): HudSettings {
  try {
    const raw = localStorage.getItem(HUD_SETTINGS_KEY)
    if (!raw) return DEFAULT_HUD_SETTINGS
    return normalizeHudSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_HUD_SETTINGS
  }
}

export function saveHudSettings(settings: HudSettings) {
  localStorage.setItem(HUD_SETTINGS_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent<HudSettings>('stowmind-hud-settings', { detail: settings }))
}

export function toggleHudMetric(settings: HudSettings, metric: HudMetricKey): HudSettings {
  const active = settings.visibleMetrics.includes(metric)
  if (active && settings.visibleMetrics.length === 1) return settings
  return {
    ...settings,
    visibleMetrics: active
      ? settings.visibleMetrics.filter((item) => item !== metric)
      : [...settings.visibleMetrics, metric],
  }
}
