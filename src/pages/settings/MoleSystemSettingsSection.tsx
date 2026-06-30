import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { getSystemSettingsState, openSystemSettingsTarget, type NativeSystemSettingsState } from '@/lib/systemSettings'
import { open as openUrl } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import { platform as getPlatform, type Platform } from '@tauri-apps/api/os'
import {
  Cpu,
  KeyRound,
  LogIn,
  Monitor,
  RefreshCw,
  Sparkles,
  Shield,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { applyHudNativeSettings } from '../hud/native'
import { HUD_METRICS, loadHudSettings, saveHudSettings, toggleHudMetric, type HudMetricKey, type HudSettings } from '../hud/settings'

type SystemTarget = 'launchAtLogin' | 'fullDiskAccess'

function nativeSettingsTarget(target: SystemTarget, platform: Platform | null) {
  if (platform !== 'darwin' && platform !== 'win32') return null
  return target === 'launchAtLogin' ? 'login_items' : 'full_disk_access'
}

function platformBadgeLabel(platform: Platform | null) {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return 'Other'
}

export function MoleSystemSettingsSection() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [systemState, setSystemState] = useState<NativeSystemSettingsState | null>(null)
  const [systemLoading, setSystemLoading] = useState(false)
  const [hudSettings, setHudSettings] = useState<HudSettings>(() => loadHudSettings())

  useEffect(() => {
    let active = true
    void getPlatform()
      .then((value) => {
        if (active) setPlatform(value)
      })
      .catch(() => {
        if (active) setPlatform(null)
      })

    return () => {
      active = false
    }
  }, [])

  const refreshSystemState = async () => {
    setSystemLoading(true)
    try {
      const next = await getSystemSettingsState()
      setSystemState(next)
    } catch (error) {
      toast.error(t('settings.mole.stateFail', { error: String(error) }))
    } finally {
      setSystemLoading(false)
    }
  }

  useEffect(() => {
    void refreshSystemState()
    const onSettings = (event: Event) => {
      const next = (event as CustomEvent<HudSettings>).detail
      if (next) setHudSettings(next)
    }
    window.addEventListener('stowmind-hud-settings', onSettings)
    return () => window.removeEventListener('stowmind-hud-settings', onSettings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const launchAtLoginTarget = useMemo(() => nativeSettingsTarget('launchAtLogin', platform), [platform])
  const fullDiskAccessTarget = useMemo(() => nativeSettingsTarget('fullDiskAccess', platform), [platform])

  const openNativeSettings = async (target: SystemTarget) => {
    const settingsTarget = nativeSettingsTarget(target, platform)
    if (!settingsTarget) {
      toast.info(t('settings.mole.unsupported'))
      return
    }

    try {
      await openSystemSettingsTarget(settingsTarget)
    } catch (error) {
      toast.error(t('settings.mole.openFail', { error: String(error) }))
    }
  }

  const updateLaunchAtLogin = async (enabled: boolean) => {
    setSystemLoading(true)
    try {
      const next = await invoke<NativeSystemSettingsState>('set_system_launch_at_login', { enabled })
      setSystemState(next)
      toast.success(enabled ? t('settings.moleLaunchEnabled') : t('settings.moleLaunchDisabled'))
    } catch (error) {
      toast.error(t('settings.mole.openFail', { error: String(error) }))
    } finally {
      setSystemLoading(false)
    }
  }

  const updateHudSettings = (next: HudSettings) => {
    setHudSettings(next)
    saveHudSettings(next)
    void applyHudNativeSettings(next, null, t).catch((error) => {
      toast.error(t('hud.shortcutFail', { error: String(error) }))
    })
  }

  const toggleMetric = (metric: HudMetricKey) => {
    updateHudSettings(toggleHudMetric(hudSettings, metric))
  }

  const fullDiskVariant = systemState?.fullDiskAccessStatus === 'granted'
    ? 'success'
    : systemState?.fullDiskAccessStatus === 'denied'
      ? 'warning'
      : 'outline'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          {t('settings.moleSystemTitle')}
        </CardTitle>
        <CardDescription>{t('settings.moleSystemDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SettingsRow
          icon={LogIn}
          title={t('settings.moleLaunchAtLogin')}
          description={t('settings.moleLaunchAtLoginDesc')}
          badges={
            <>
              <Badge variant={systemState?.launchAtLoginEnabled ? 'success' : 'outline'}>
                {systemState?.launchAtLoginEnabled ? t('settings.mole.enabled') : t('settings.mole.disabled')}
              </Badge>
              <Badge variant="outline">{platformBadgeLabel(platform)}</Badge>
            </>
          }
          actions={
            <>
              <Switch
                checked={Boolean(systemState?.launchAtLoginEnabled)}
                disabled={systemLoading || !systemState?.launchAtLoginSupported}
                onCheckedChange={(checked) => void updateLaunchAtLogin(checked)}
              />
              <Button variant="secondary" onClick={() => void openNativeSettings('launchAtLogin')} disabled={!launchAtLoginTarget}>
                {t('settings.moleOpenLaunchAtLogin')}
              </Button>
              <Button variant="outline" onClick={() => void refreshSystemState()} disabled={systemLoading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${systemLoading ? 'animate-spin' : ''}`} />
                {t('settings.moleRefreshState')}
              </Button>
            </>
          }
        />

        <SettingsRow
          icon={Shield}
          title={t('settings.moleFullDiskAccess')}
          description={t('settings.moleFullDiskAccessDesc')}
          badges={
            <>
              <Badge variant={fullDiskVariant}>{t(`settings.mole.fda.${systemState?.fullDiskAccessStatus ?? 'unknown'}` as Parameters<typeof t>[0])}</Badge>
              <Badge variant="outline">{platformBadgeLabel(platform)}</Badge>
            </>
          }
          actions={
            <>
              <Button variant="secondary" onClick={() => void openNativeSettings('fullDiskAccess')} disabled={!fullDiskAccessTarget}>
                {t('settings.moleOpenFullDiskAccess')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/doctor')}>
                {t('settings.moleOpenDoctor')}
              </Button>
            </>
          }
        />

        <SettingsRow
          icon={Trash2}
          title={t('settings.moleDeleteMode')}
          description={t('settings.moleDeleteModeDesc')}
          badges={
            <>
              <Badge variant="outline">{t('settings.mole.moleManaged')}</Badge>
              <Badge variant="outline">{t('settings.mole.trashRouting')}</Badge>
            </>
          }
          actions={
            <Button variant="secondary" onClick={() => navigate('/clean')}>
              {t('settings.moleOpenClean')}
            </Button>
          }
        />

        <SettingsRow
          icon={Sparkles}
          title={t('settings.molePlanetLanding')}
          description={t('settings.molePlanetLandingDesc')}
          badges={
            <>
              <Badge variant="success">{t('settings.mole.planetIntro')}</Badge>
              <Badge variant="outline">{t('moleMap.title')}</Badge>
            </>
          }
          actions={
            <>
              <Button variant="secondary" onClick={() => navigate('/mole-map')}>
                {t('settings.moleOpenMap')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/hud')}>
                {t('settings.moleOpenHud')}
              </Button>
            </>
          }
        />

        <SettingsRow
          icon={KeyRound}
          title={t('settings.moleLicenseActivation')}
          description={t('settings.moleLicenseActivationDesc')}
          badges={
            <>
              <Badge variant="success">Cmd + Shift + L</Badge>
              <Badge variant="outline">{t('settings.mole.menu')}</Badge>
            </>
          }
          actions={
            <Button variant="secondary" onClick={() => void openUrl('https://mole.fit/')}>
              {t('settings.moleOpenHelp')}
            </Button>
          }
        />

        <div className="rounded-2xl border bg-surface-hover px-4 py-3">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{t('settings.moleMenuBarMonitor')}</p>
                    <Badge variant={hudSettings.trayStyle === 'metrics' ? 'success' : 'outline'}>
                      {hudSettings.trayStyle === 'metrics' ? t('hud.trayStyle.metrics') : t('hud.trayStyle.icon')}
                    </Badge>
                    <Badge variant={hudSettings.hideDockIcon ? 'success' : 'outline'}>
                      {hudSettings.hideDockIcon ? t('settings.moleDockHidden') : t('settings.moleDockVisible')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t('settings.moleMenuBarMonitorDesc')}</p>
                </div>
              </div>
              <Button variant="outline" onClick={() => navigate('/hud')}>
                {t('settings.moleOpenHud')}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InlineSwitch
                title={t('hud.hideDockIcon')}
                checked={hudSettings.hideDockIcon}
                onCheckedChange={(checked) => updateHudSettings({ ...hudSettings, hideDockIcon: checked })}
              />
              <InlineSwitch
                title={t('hud.cpuAlerts')}
                checked={hudSettings.cpuAlerts}
                onCheckedChange={(checked) => updateHudSettings({ ...hudSettings, cpuAlerts: checked })}
              />
              <InlineSwitch
                title={t('hud.trayStyle.metrics')}
                checked={hudSettings.trayStyle === 'metrics'}
                onCheckedChange={(checked) => updateHudSettings({ ...hudSettings, trayStyle: checked ? 'metrics' : 'icon' })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {HUD_METRICS.map((metric) => (
                <Button
                  key={metric}
                  variant={hudSettings.visibleMetrics.includes(metric) ? 'default' : 'outline'}
                  size="sm"
                  disabled={hudSettings.visibleMetrics.length === 1 && hudSettings.visibleMetrics.includes(metric)}
                  onClick={() => toggleMetric(metric)}
                >
                  {t(`hud.metric.${metric}` as Parameters<typeof t>[0])}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed bg-surface-hover/10 px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.moleVisualizedElsewhere')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.moleVisualizedElsewhereDesc')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate('/doctor')}>
                <Cpu className="mr-2 h-4 w-4" />
                {t('doctor.title')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/hud')}>
                <Monitor className="mr-2 h-4 w-4" />
                {t('hud.title')}
              </Button>
            </div>
          </div>
        </div>

      </CardContent>
    </Card>
  )
}

function InlineSwitch({
  title,
  checked,
  onCheckedChange,
}: {
  title: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-surface-hover/40 px-3 py-2">
      <p className="text-sm font-medium">{title}</p>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function SettingsRow({
  icon: Icon,
  title,
  description,
  badges,
  actions,
}: {
  icon: typeof Cpu
  title: string
  description: string
  badges: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="rounded-2xl border bg-surface-hover px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{title}</p>
              <div className="flex flex-wrap gap-2">{badges}</div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </div>
  )
}
