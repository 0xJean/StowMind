import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { buildCleanupActivitySummary } from '@/lib/stowmind-supplements/cleanupActivity'
import { formatDate, formatDecimal, formatFileSize } from '@/lib/utils'
import { useAppStore, type HistoryRecord } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'
import { appWindow } from '@tauri-apps/api/window'
import {
  AlertTriangle,
  BatteryCharging,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Thermometer,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { applyHudTraySettings, applyHudWindowMode, openHudPopover } from './hud/native'
import { loadHudStatusCache, saveHudStatusCache } from './hud/cache'
import { buildHudCpuAlert, notifyHudCpuAlert } from './hud/alerts'
import { loadHudSettings, saveHudSettings, toggleHudMetric, type HudMetricKey, type HudSettings } from './hud/settings'
import { HudChip, HudMetricTile, HudRoundStat, HudWatchStat } from './hud/HudWidgets'
import { HudSettingsPanel } from './hud/HudSettingsPanel'
import type { MoleStatusRaw } from './status/advancedTypes'
import { findPrimaryDisk, findPrimaryNetwork, sortProcesses } from './status/diagnostics'
import { formatTemperature, getPrimaryTemperature, getValidFanSpeed, getValidGpuUsage, getValidTemperature } from './status/sensorReadings'
import { formatMaybe, formatPercent, formatRate } from './status/utils'

interface HudHistory {
  cpu: number[]
  memory: number[]
  networkRx: number[]
  networkTx: number[]
  diskRead: number[]
  diskWrite: number[]
}

const EMPTY_HISTORY: HudHistory = {
  cpu: [],
  memory: [],
  networkRx: [],
  networkTx: [],
  diskRead: [],
  diskWrite: [],
}

const TRAY_ACTIVITY_FRAMES = ['|', '/', '-', '\\']
const DRAG_EXCLUDE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a',
  '[role="button"]',
  '[data-tauri-drag-exclude]',
].join(',')

const HEALTH_LEVEL_KEYS: Record<string, string> = {
  good: 'hud.health.good',
  fair: 'hud.health.fair',
  poor: 'hud.health.poor',
}

const HEALTH_REASON_KEYS: Record<string, string> = {
  'high cpu': 'hud.health.reason.highCpu',
  'high memory': 'hud.health.reason.highMemory',
  'high disk': 'hud.health.reason.highDisk',
  'restart recommended': 'hud.health.reason.restartRecommended',
}

function formatHudHealthMessage(message: string | undefined, t: ReturnType<typeof useI18n>['t']) {
  if (!message) return t('hud.loading')
  const [rawLevel, rawReasons] = message.split(':', 2)
  const levelKey = HEALTH_LEVEL_KEYS[rawLevel.trim().toLowerCase()]
  if (!levelKey) return message

  const reasons = rawReasons
    ?.split(',')
    .map((reason) => reason.trim())
    .filter(Boolean) ?? []
  const localizedReasons = reasons.map((reason) => {
    const reasonKey = HEALTH_REASON_KEYS[reason.toLowerCase()]
    return reasonKey ? t(reasonKey as Parameters<typeof t>[0]) : reason
  })
  const level = t(levelKey as Parameters<typeof t>[0])
  return localizedReasons.length > 0 ? level + ': ' + localizedReasons.join(', ') : level
}

function appendSample(values: number[], value: number | undefined) {
  return [...values, Number.isFinite(value) ? Number(value) : 0].slice(-24)
}

function appendHudHistory(current: HudHistory, data: MoleStatusRaw): HudHistory {
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

function cleanupSummary(history: HistoryRecord[]) {
  const cleanup = history.filter((record) => ['clean', 'purge', 'installer', 'uninstall', 'optimize'].includes(record.type ?? 'organize'))
  const executed = cleanup.filter((record) => record.executed)
  const cleaned = executed.reduce((sum, record) => sum + (record.cleanupSummary?.totalSize ?? 0), 0)
  return {
    cleaned,
    scans: cleanup.length,
    optimized: cleanup.filter((record) => record.type === 'optimize').length,
  }
}

function shouldStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target.closest(DRAG_EXCLUDE_SELECTOR)) return false
  return Boolean(target.closest('[data-tauri-drag-region]'))
}

export function HudPage() {
  const { t, locale } = useI18n()
  const historyRecords = useAppStore((s) => s.history)
  const statistics = useAppStore((s) => s.statistics)
  const [cachedStatus, setCachedStatus] = useState(() => loadHudStatusCache())
  const [data, setData] = useState<MoleStatusRaw | null>(() => cachedStatus?.data ?? null)
  const [hudHistory, setHudHistory] = useState<HudHistory>(EMPTY_HISTORY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<HudSettings>(() => loadHudSettings())
  const [shortcutDraft, setShortcutDraft] = useState(() => settings.shortcut)
  const [trayFrameIndex, setTrayFrameIndex] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef(settings)
  const initialWindowModeAppliedRef = useRef(false)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const refresh = async () => {
    setLoading(true)
    try {
      const next = await invoke<MoleStatusRaw>('mole_status_raw_json')
      setData(next)
      saveHudStatusCache(next)
      setCachedStatus(null)
      setHudHistory((current) => appendHudHistory(current, next))
      setError(null)
      await notifyHudCpuAlert(buildHudCpuAlert(next, t), settingsRef.current.cpuAlerts, t)
    } catch (err) {
      const message = String(err)
      setError(message)
      toast.error(t('hud.fail', { error: message }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTrayFrameIndex((value) => (value + 1) % TRAY_ACTIVITY_FRAMES.length)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onSettings = (event: Event) => {
      const next = (event as CustomEvent<HudSettings>).detail
      if (!next) return
      setSettings(next)
      setShortcutDraft(next.shortcut)
    }
    window.addEventListener('stowmind-hud-settings', onSettings)
    return () => window.removeEventListener('stowmind-hud-settings', onSettings)
  }, [])

  useEffect(() => {
    const center = !initialWindowModeAppliedRef.current
    initialWindowModeAppliedRef.current = true
    void applyHudWindowMode(settings, { center }).catch(() => {})
  }, [settings.alwaysOnTop, settings.compact, settings.hideDockIcon])

  useEffect(() => {
    void applyHudTraySettings(settings, data, t, TRAY_ACTIVITY_FRAMES[trayFrameIndex]).catch(() => {})
  }, [data, locale, settings, t, trayFrameIndex])

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !shouldStartWindowDrag(event.target)) return
      void invoke('hud_start_dragging').catch(() => {})
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [])

  const primaryDisk = useMemo(() => findPrimaryDisk(data?.disks), [data])
  const primaryNetwork = findPrimaryNetwork(data?.network)
  const battery = data?.batteries?.[0]
  const gpu = data?.gpu?.[0]
  const thermal = data?.thermal ?? null
  const gpuUsage = getValidGpuUsage(gpu)
  const cpuTemperature = getValidTemperature(thermal?.cpu_temp)
  const primaryTemperature = getPrimaryTemperature(thermal)
  const fanSpeed = getValidFanSpeed(thermal)
  const topProcesses = useMemo(() => sortProcesses(data?.top_processes).slice(0, 5), [data])
  const cleanWatch = useMemo(() => cleanupSummary(historyRecords), [historyRecords])
  const cleanupActivity = useMemo(
    () => buildCleanupActivitySummary(historyRecords, statistics),
    [historyRecords, statistics]
  )
  const cpuAlert = useMemo(() => buildHudCpuAlert(data, t), [data, t])
  const usingCachedStatus = Boolean(cachedStatus && data === cachedStatus.data)
  const activityLabel = cleanupActivity.latestExecuted
    ? t('hud.activity.latest', {
      type: t(`history.type.${cleanupActivity.latestExecuted.type ?? 'clean'}` as Parameters<typeof t>[0]),
      time: formatDate(cleanupActivity.latestExecuted.timestamp),
    })
    : t('hud.activity.idle')

  const updateHudSettings = (next: HudSettings) => {
    setSettings(next)
    saveHudSettings(next)
  }

  const saveShortcut = async () => {
    try {
      const shortcut = await invoke<string>('hud_set_shortcut', { shortcut: shortcutDraft })
      updateHudSettings({ ...settings, shortcut })
      setShortcutDraft(shortcut)
      toast.success(t('hud.shortcutSaved'))
    } catch (err) {
      toast.error(t('hud.shortcutFail', { error: String(err) }))
    }
  }

  const openPopover = async () => {
    try {
      await openHudPopover()
    } catch (err) {
      toast.error(t('hud.popoverFail', { error: String(err) }))
    }
  }

  const hideHud = async () => {
    try {
      await invoke('hud_remember_position')
      await appWindow.hide()
    } catch (err) {
      toast.error(t('hud.hideFail', { error: String(err) }))
    }
  }

  const toggleMetric = (metric: HudMetricKey) => {
    updateHudSettings(toggleHudMetric(settings, metric))
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col gap-3 px-3 py-3 text-foreground">
      <div className="flex cursor-move items-center justify-between gap-3 px-1 py-1" data-tauri-drag-region>
        <div className="flex min-w-0 items-center gap-3">
          <img src="/icon.svg" alt="StowMind" className="h-8 w-8 shrink-0" draggable={false} />
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight">StowMind</h1>
            <p className="truncate text-xs text-muted-foreground">
              {data
                ? t(usingCachedStatus ? 'hud.cachedAt' : 'hud.collectedAt', { value: formatDate(data.collected_at) })
                : t('hud.loading')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2" data-tauri-drag-exclude>
          <HudSettingsPanel
            open={settingsOpen}
            loading={loading}
            settings={settings}
            shortcutDraft={shortcutDraft}
            onOpenChange={setSettingsOpen}
            onRefresh={() => void refresh()}
            onOpenPopover={() => void openPopover()}
            onShortcutDraftChange={setShortcutDraft}
            onSaveShortcut={() => void saveShortcut()}
            onUpdateSettings={updateHudSettings}
            onToggleMetric={toggleMetric}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="cursor-pointer"
            aria-label={t('hud.hide')}
            title={t('hud.hide')}
            onClick={() => void hideHud()}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="space-y-2.5">
          {usingCachedStatus && (
            <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
              {t(loading ? 'hud.cacheRefreshing' : 'hud.cacheLoaded')}
            </div>
          )}

          {error && !data && (
            <div className="iqon-card p-5">
              <h3 className="text-sm font-bold text-foreground">{t('hud.errorTitle')}</h3>
              <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
            </div>
          )}

          <div className="flex items-start justify-between gap-4 px-1 py-1">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums">{data?.health_score ?? '—'}</span>
                <span className="text-sm font-medium text-clean-green">{formatHudHealthMessage(data?.health_score_msg, t)}</span>
              </div>
              <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full border border-clean-green/20 bg-clean-green/10 px-2.5 py-1 text-[11px] text-clean-green">
                <span className="font-mono">{TRAY_ACTIVITY_FRAMES[trayFrameIndex]}</span>
                <span className="truncate">{activityLabel}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <HudChip value={data?.hardware.model ?? data?.host ?? 'StowMind'} />
                <HudChip value={data?.hardware.os_version ?? data?.platform ?? '—'} />
                <HudChip value={formatMaybe(data?.uptime)} />
                {data?.proxy?.enabled && <HudChip value={data.proxy.type || 'Proxy'} />}
              </div>
            </div>
            <div className="rounded-full border border-primary/30 bg-primary/10 p-2 text-primary">
              <Gauge className="h-5 w-5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {cpuAlert && (
              <div
                className={
                  'col-span-2 rounded-xl border px-3 py-2 text-xs ' +
                  (cpuAlert.severity === 'destructive'
                    ? 'border-clean-red/30 bg-clean-red/15 text-clean-red'
                    : 'border-clean-yellow/30 bg-clean-yellow/15 text-yellow-600 dark:text-clean-yellow')
                }
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold">{cpuAlert.title}</p>
                    <p className="mt-0.5 break-words text-muted-foreground">{cpuAlert.detail}</p>
                  </div>
                </div>
              </div>
            )}
            <HudMetricTile
              icon={Cpu}
              title={t('hud.metric.cpu')}
              badge={cpuTemperature === undefined ? undefined : formatTemperature(cpuTemperature)}
              value={formatPercent(data?.cpu.usage)}
              detail={data ? t('hud.metric.cpuDetail', { cores: data.cpu.logical_cpu }) : t('hud.loading')}
              sparkline={hudHistory.cpu}
              accent="emerald"
            />
            <HudMetricTile
              icon={MemoryStick}
              title={t('hud.metric.memory')}
              badge={data?.memory.pressure}
              value={formatPercent(data?.memory.used_percent)}
              detail={data ? formatFileSize(data.memory.used) + ' / ' + formatFileSize(data.memory.total) : t('hud.loading')}
              sparkline={hudHistory.memory}
              accent="amber"
            />
            <HudMetricTile
              icon={Wifi}
              title={t('hud.metric.network')}
              badge={primaryNetwork?.name}
              value={formatRate(primaryNetwork?.rx_rate_mbs)}
              detail={formatRate(primaryNetwork?.tx_rate_mbs) + ' ' + t('hud.field.networkTx')}
              dualSparkline={{ a: hudHistory.networkRx, b: hudHistory.networkTx }}
              accent="cyan"
            />
            <HudMetricTile
              icon={HardDrive}
              title={t('hud.metric.disk')}
              value={formatPercent(primaryDisk?.used_percent)}
              detail={primaryDisk ? t('hud.metric.diskFree', { value: formatFileSize(primaryDisk.total - primaryDisk.used) }) : t('hud.loading')}
              progress={primaryDisk?.used_percent}
              accent="blue"
            />
            <HudMetricTile
              icon={Zap}
              title={t('hud.metric.gpu')}
              value={formatPercent(gpuUsage)}
              detail={gpu ? gpu.name : t('hud.metric.unavailable')}
              accent="orange"
            />
            <HudMetricTile
              icon={Thermometer}
              title={t('hud.metric.thermal')}
              value={primaryTemperature ? formatTemperature(primaryTemperature.value) : '—'}
              detail={
                primaryTemperature
                  ? t(('hud.metric.temperatureKind.' + primaryTemperature.kind) as Parameters<typeof t>[0])
                  : fanSpeed === undefined
                    ? t('hud.metric.unavailable')
                    : t('hud.metric.fanSpeed', { value: formatDecimal(fanSpeed, 0) })
              }
              accent="rose"
            />
          </div>

          <div className="iqon-row p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
                  <BatteryCharging className="h-3.5 w-3.5" />
                  {t('hud.metric.battery')}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{battery ? formatPercent(battery.percent) : '—'}</p>
                <p className="truncate text-xs text-muted-foreground">{battery ? battery.status + ' · ' + battery.time_left : t('status.empty.battery')}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <HudRoundStat label={t('hud.field.diskRead')} value={formatRate(data?.disk_io.read_rate)} />
                <HudRoundStat label={t('hud.field.diskWrite')} value={formatRate(data?.disk_io.write_rate)} />
              </div>
            </div>
          </div>

          <div className="iqon-row p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
              <span>{t('hud.processTitle')}</span>
              <span className="grid grid-cols-2 gap-5 normal-case tracking-normal">
                <span>CPU</span>
                <span>{t('hud.field.memory')}</span>
              </span>
            </div>
            <div className="space-y-2">
              {topProcesses.length ? topProcesses.map((process) => (
                <div key={process.pid} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
                  <span className="truncate font-semibold text-foreground">{process.name}</span>
                  <span className="tabular-nums text-muted-foreground">{formatPercent(process.cpu)}</span>
                  <span className="tabular-nums text-muted-foreground">{formatPercent(process.memory)}</span>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground">{t('hud.emptyProcess')}</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-clean-green/20 bg-clean-green/10 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-clean-green">
                <Trash2 className="h-3.5 w-3.5" />
                {t('hud.cleanWatch')}
              </p>
              <span className="text-sm font-bold tabular-nums text-foreground">{formatFileSize(data?.trash_size ?? 0)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <HudWatchStat label={t('hud.cleanWatch.cleaned')} value={formatFileSize(cleanupActivity.totalFreed || cleanWatch.cleaned)} />
              <HudWatchStat label={t('hud.cleanWatch.scans')} value={String(cleanupActivity.executedCount + cleanupActivity.previewCount || cleanWatch.scans)} />
              <HudWatchStat label={t('hud.cleanWatch.optimized')} value={String(cleanupActivity.optimizedCount || cleanWatch.optimized)} />
            </div>
            <p className="mt-2 truncate text-[11px] text-muted-foreground">
              {cleanupActivity.latest
                ? t('hud.cleanWatch.latest', { target: cleanupActivity.latest.directory })
                : t('hud.cleanWatch.empty')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
