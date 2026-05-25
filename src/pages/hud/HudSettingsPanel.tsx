import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import {
  Activity,
  Gauge,
  Keyboard,
  MoreHorizontal,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { HUD_METRICS, type HudMetricKey, type HudSettings } from './settings'
import { MetricToggle, TogglePanel } from './HudWidgets'

interface HudSettingsPanelProps {
  open: boolean
  loading: boolean
  settings: HudSettings
  shortcutDraft: string
  onOpenChange: (open: boolean) => void
  onRefresh: () => void
  onOpenPopover: () => void
  onShortcutDraftChange: (shortcut: string) => void
  onSaveShortcut: () => void
  onUpdateSettings: (settings: HudSettings) => void
  onToggleMetric: (metric: HudMetricKey) => void
}

export function HudSettingsPanel({
  open,
  loading,
  settings,
  shortcutDraft,
  onOpenChange,
  onRefresh,
  onOpenPopover,
  onShortcutDraftChange,
  onSaveShortcut,
  onUpdateSettings,
  onToggleMetric,
}: HudSettingsPanelProps) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const openRoute = (route: string) => {
    onOpenChange(false)
    navigate(route)
  }

  return (
    <div className="relative shrink-0" data-tauri-drag-exclude>
      <Button
        variant="outline"
        size="icon"
        className="cursor-pointer"
        aria-label={t('hud.settingsEntry')}
        title={t('hud.settingsEntry')}
        onClick={() => onOpenChange(!open)}
      >
        <Settings className="h-4 w-4" />
      </Button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            aria-label={t('hud.settingsClose')}
            onClick={() => onOpenChange(false)}
          />
          <div className="absolute right-0 top-12 z-40 w-[min(360px,calc(100vw-2rem))] cursor-default rounded-2xl border border-border/70 bg-popover p-3 text-popover-foreground shadow-clean" data-tauri-drag-exclude>
            <div className="flex items-start justify-between gap-3 px-1 pb-3">
              <div className="min-w-0">
                <p className="font-bold">{t('hud.settingsTitle')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('hud.settingsDesc')}</p>
              </div>
              <Button variant="ghost" size="icon" aria-label={t('hud.settingsClose')} onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-surface-hover p-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                  {t('hud.settingsActions')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    {t('hud.refresh')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openRoute('/status')}>
                    <Activity className="mr-2 h-4 w-4" />
                    {t('hud.openStatus')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    onOpenChange(false)
                    onOpenPopover()
                  }}>
                    <Gauge className="mr-2 h-4 w-4" />
                    {t('hud.openPopover')}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-surface-hover p-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Keyboard className="h-4 w-4" />
                  {t('hud.shortcutTitle')}
                </p>
                <div className="flex gap-2">
                  <Input value={shortcutDraft} onChange={(event) => onShortcutDraftChange(event.target.value)} className="h-10 font-mono text-sm" />
                  <Button variant="outline" size="sm" onClick={onSaveShortcut}>{t('hud.saveShortcut')}</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('hud.shortcutCurrent', { value: settings.shortcut })}</p>
              </div>

              <div className="space-y-2">
                <TogglePanel title={t('hud.compactMode')} description={t('hud.compactModeDesc')} checked={settings.compact} onCheckedChange={(checked) => onUpdateSettings({ ...settings, compact: checked })} />
                <TogglePanel title={t('hud.alwaysOnTop')} description={t('hud.alwaysOnTopDesc')} checked={settings.alwaysOnTop} onCheckedChange={(checked) => onUpdateSettings({ ...settings, alwaysOnTop: checked })} disabled={!settings.compact} />
                <TogglePanel title={t('hud.hideDockIcon')} description={t('hud.hideDockIconDesc')} checked={settings.hideDockIcon} onCheckedChange={(checked) => onUpdateSettings({ ...settings, hideDockIcon: checked })} />
                <TogglePanel title={t('hud.cpuAlerts')} description={t('hud.cpuAlertsDesc')} checked={settings.cpuAlerts} onCheckedChange={(checked) => onUpdateSettings({ ...settings, cpuAlerts: checked })} />
              </div>

              <div className="rounded-xl border border-border/70 bg-surface-hover p-3">
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="font-medium">{t('hud.trayStyle')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('hud.trayStyleDesc')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant={settings.trayStyle === 'metrics' ? 'default' : 'outline'} size="sm" onClick={() => onUpdateSettings({ ...settings, trayStyle: 'metrics' })}>{t('hud.trayStyle.metrics')}</Button>
                    <Button variant={settings.trayStyle === 'icon' ? 'default' : 'outline'} size="sm" onClick={() => onUpdateSettings({ ...settings, trayStyle: 'icon' })}>{t('hud.trayStyle.icon')}</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {HUD_METRICS.map((metric) => (
                      <MetricToggle
                        key={metric}
                        label={t(`hud.metric.${metric}` as Parameters<typeof t>[0])}
                        checked={settings.visibleMetrics.includes(metric)}
                        disabled={settings.visibleMetrics.length === 1 && settings.visibleMetrics.includes(metric)}
                        onClick={() => onToggleMetric(metric)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
