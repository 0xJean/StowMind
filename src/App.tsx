import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { Download, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { AppRoutes } from './AppRoutes'
import { Button } from './components/ui/button'
import { Sidebar } from './components/Sidebar'
import { useDashboardCacheSync } from './hooks/useDashboardCacheSync'
import { useI18n } from './i18n'
import { checkMoleInstallation, fallbackMoleStatus } from './lib/mole'
import { resultCacheKeys, saveResultSnapshot } from './lib/resultCache'
import {
  getSystemSettingsState,
  openSystemSettingsTarget,
  shouldPromptFullDiskAccess,
  type NativeSystemSettingsState,
} from './lib/systemSettings'
import { HudPage } from './pages/HudPage'
import { loadHudSettings } from './pages/hud/settings'
import type { MoleDoctorResult } from './pages/mole/doctorTypes'
import { DiskAccessSetupPage } from './pages/onboarding/DiskAccessSetupPage'
import { MoleSetupPage } from './pages/onboarding/MoleSetupPage'
import { useAppStore } from './stores/app'
import { useMoleStore } from './stores/mole'

interface WatchFolderChangePayload {
  paths: string[]
  kind: string
}

const LAST_ROUTE_KEY = 'stowmind.lastRoute.v1'
const DISK_ACCESS_SETUP_KEY = 'stowmind.diskAccessSetup.v1'
const MOLE_SETUP_KEY = 'stowmind.moleSetup.v1'
const CACHEABLE_ROUTES = new Set([
  '/',
  '/organize',
  '/history',
  '/statistics',
  '/duplicates',
  '/clean',
  '/installers',
  '/optimize',
  '/apps',
  '/analyze',
  '/purge',
  '/status',
  '/doctor',
  '/software-update',
  '/settings',
])

function isCacheableRoute(pathname: string) {
  if (pathname === '/uninstall') return true
  return CACHEABLE_ROUTES.has(pathname)
}

function App() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  useDashboardCacheSync()
  const setOllamaOnline = useAppStore((s) => s.setOllamaOnline)
  const aiProvider = useAppStore((s) => s.aiProvider)
  const watchFolderEnabled = useAppStore((s) => s.watchFolderEnabled)
  const watchFolderPathsText = useAppStore((s) => s.watchFolderPathsText)
  const moleStatus = useMoleStore((s) => s.status)
  const moleChecked = useMoleStore((s) => s.checked)
  const moleUpdate = useMoleStore((s) => s.update)
  const startMoleCheck = useMoleStore((s) => s.startStatusCheck)
  const setMoleStatus = useMoleStore((s) => s.setStatus)
  const setMoleUpdateChecking = useMoleStore((s) => s.setUpdateChecking)
  const setMoleUpdateResult = useMoleStore((s) => s.setUpdateResult)
  const setMoleUpdateError = useMoleStore((s) => s.setUpdateError)
  const clearMoleUpdate = useMoleStore((s) => s.clearUpdate)
  const previousPathRef = useRef(location.pathname)
  const restoredRouteRef = useRef(false)
  const startupUpdateCheckedRef = useRef(false)
  const isHudRoute = location.pathname === '/hud'
  const [hudMounted, setHudMounted] = useState(() => isHudRoute)
  const [diskAccessPreference, setDiskAccessPreference] = useState<'done' | 'skipped' | null>(() => {
    const saved = localStorage.getItem(DISK_ACCESS_SETUP_KEY)
    return saved === 'done' || saved === 'skipped' ? saved : null
  })
  const [systemState, setSystemState] = useState<NativeSystemSettingsState | null>(null)
  const [systemStateChecked, setSystemStateChecked] = useState(() => diskAccessPreference !== null)
  const [systemStateLoading, setSystemStateLoading] = useState(false)
  const [moleSetupPreference, setMoleSetupPreference] = useState<'done' | 'skipped' | null>(() => {
    const saved = localStorage.getItem(MOLE_SETUP_KEY)
    return saved === 'done' || saved === 'skipped' ? saved : null
  })

  const refreshDiskAccessState = useCallback(async (options?: { notifyOnError?: boolean; skipOnError?: boolean }) => {
    setSystemStateLoading(true)
    try {
      const next = await getSystemSettingsState()
      setSystemState(next)
      if (!shouldPromptFullDiskAccess(next)) {
        localStorage.setItem(DISK_ACCESS_SETUP_KEY, 'done')
        setDiskAccessPreference('done')
      }
      return next
    } catch (error) {
      if (options?.notifyOnError) {
        toast.error(t('diskAccessSetup.stateFail', { error: String(error) }))
      }
      if (options?.skipOnError) {
        localStorage.setItem(DISK_ACCESS_SETUP_KEY, 'skipped')
        setDiskAccessPreference('skipped')
      }
      return null
    } finally {
      setSystemStateChecked(true)
      setSystemStateLoading(false)
    }
  }, [t])

  const openFullDiskAccessSettings = useCallback(async () => {
    try {
      await openSystemSettingsTarget('full_disk_access')
    } catch (error) {
      toast.error(t('settings.mole.openFail', { error: String(error) }))
    }
  }, [t])

  const recheckDiskAccess = useCallback(async () => {
    const next = await refreshDiskAccessState({ notifyOnError: true })
    if (!next) return
    if (shouldPromptFullDiskAccess(next)) {
      toast.info(t('diskAccessSetup.missingToast'))
      return
    }
    toast.success(t('diskAccessSetup.readyToast'))
  }, [refreshDiskAccessState, t])

  const skipDiskAccessSetup = useCallback(() => {
    localStorage.setItem(DISK_ACCESS_SETUP_KEY, 'skipped')
    setDiskAccessPreference('skipped')
  }, [])

  const checkMole = useCallback(async () => {
    startMoleCheck()
    try {
      const status = await checkMoleInstallation()
      setMoleStatus(status)
      if (status.installed) {
        localStorage.setItem(MOLE_SETUP_KEY, 'done')
        setMoleSetupPreference('done')
      }
      return status
    } catch {
      const status = fallbackMoleStatus()
      setMoleStatus(status)
      return status
    }
  }, [setMoleStatus, startMoleCheck])

  const skipMoleSetup = useCallback(() => {
    localStorage.setItem(MOLE_SETUP_KEY, 'skipped')
    setMoleSetupPreference('skipped')
  }, [])

  useEffect(() => {
    if (restoredRouteRef.current) return
    restoredRouteRef.current = true

    const saved = localStorage.getItem(LAST_ROUTE_KEY)
    if (saved === '/uninstall') {
      navigate('/apps', { replace: true })
      return
    }
    if (
      location.pathname === '/' &&
      saved &&
      saved !== '/' &&
      isCacheableRoute(saved)
    ) {
      navigate(saved, { replace: true })
    }
  }, [location.pathname, navigate])

  useEffect(() => {
    if (isHudRoute) {
      setHudMounted(true)
    }
  }, [isHudRoute])

  useEffect(() => {
    if (diskAccessPreference || systemStateChecked) return
    void refreshDiskAccessState({ skipOnError: true })
  }, [diskAccessPreference, refreshDiskAccessState, systemStateChecked])

  const shouldShowDiskAccessSetup =
    diskAccessPreference !== 'done' &&
    diskAccessPreference !== 'skipped' &&
    systemStateChecked &&
    shouldPromptFullDiskAccess(systemState)
  const diskAccessSetupResolved =
    diskAccessPreference === 'done' ||
    diskAccessPreference === 'skipped' ||
    (systemStateChecked && !shouldShowDiskAccessSetup)

  useEffect(() => {
    if (!diskAccessSetupResolved || moleChecked) return
    void checkMole()
  }, [checkMole, diskAccessSetupResolved, moleChecked])

  useEffect(() => {
    if (!moleChecked || !moleStatus?.installed || startupUpdateCheckedRef.current) return
    startupUpdateCheckedRef.current = true

    setMoleUpdateChecking()
    invoke<MoleDoctorResult>('mole_doctor_json')
      .then((result) => {
        setMoleUpdateResult({
          updateAvailable: result.update_available,
          updateMessage: result.update_message,
          checkedAt: result.collected_at,
        })
        void saveResultSnapshot(resultCacheKeys.softwareUpdate, {
          data: result,
          status: moleStatus,
        })
      })
      .catch((err) => {
        setMoleUpdateError(String(err))
      })
  }, [
    moleChecked,
    moleStatus,
    setMoleUpdateChecking,
    setMoleUpdateError,
    setMoleUpdateResult,
  ])

  useEffect(() => {
    if (!isCacheableRoute(location.pathname) || location.pathname === '/hud') return
    localStorage.setItem(LAST_ROUTE_KEY, location.pathname)
  }, [location.pathname])

  useEffect(() => {
    const unlisten = listen<WatchFolderChangePayload>('watch-folder-change', (event) => {
      const sample = event.payload.paths[0] ?? ''
      toast.info(
        t('watch.notify', {
          kind: event.payload.kind,
          path: sample.length > 80 ? `${sample.slice(0, 80)}…` : sample,
        })
      )
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [t])

  useEffect(() => {
    if (!diskAccessSetupResolved) return
    if (!watchFolderEnabled) {
      invoke('watch_set_paths', { paths: [] }).catch(() => {})
      return
    }
    const timer = window.setTimeout(() => {
      const paths = watchFolderPathsText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      invoke('watch_set_paths', { paths }).catch(() => {})
    }, 800)
    return () => window.clearTimeout(timer)
  }, [diskAccessSetupResolved, watchFolderEnabled, watchFolderPathsText])

  useEffect(() => {
    const checkOllama = async () => {
      if (aiProvider.type === 'ollama') {
        try {
          const online = await invoke<boolean>('check_ollama', {
            host: aiProvider.host
          })
          setOllamaOnline(online)
        } catch {
          setOllamaOnline(false)
        }
      }
    }

    checkOllama()
    const interval = setInterval(checkOllama, 10000)
    return () => clearInterval(interval)
  }, [aiProvider, setOllamaOnline])

  useEffect(() => {
    const unlisten = listen<string>('hud-toggle', (event) => {
      if (event.payload.startsWith('route:')) {
        navigate(event.payload.slice('route:'.length), { replace: true })
        return
      }
      if (event.payload === 'status') {
        navigate('/status', { replace: true })
        return
      }
      navigate('/hud', { replace: true })
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [navigate])

  useEffect(() => {
    const previousPath = previousPathRef.current
    previousPathRef.current = location.pathname
    if (previousPath !== '/hud' || location.pathname === '/hud') return

    const hudSettings = loadHudSettings()
    invoke('hud_apply_window_mode', {
      compact: false,
      alwaysOnTop: false,
      hideDockIcon: hudSettings.hideDockIcon,
    }).catch(() => {})
  }, [location.pathname])

  const shouldShowMoleSetup =
    diskAccessSetupResolved &&
    moleSetupPreference !== 'skipped' &&
    (moleStatus?.installed === false || (!moleChecked && moleSetupPreference !== 'done'))
  const showMoleUpdateBanner =
    !isHudRoute &&
    location.pathname !== '/software-update' &&
    moleUpdate.checked &&
    moleUpdate.available

  if (!diskAccessSetupResolved && !shouldShowDiskAccessSetup) {
    return (
      <div className="min-h-screen bg-background p-3 text-foreground md:p-4 2xl:p-5">
        <div className="iqon-app-window mx-auto flex h-[calc(100vh-1.5rem)] w-full items-center justify-center gap-2 text-muted-foreground md:h-[calc(100vh-2rem)] 2xl:h-[calc(100vh-2.5rem)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t('diskAccessSetup.checking')}</span>
        </div>
      </div>
    )
  }

  if (shouldShowDiskAccessSetup) {
    return (
      <div className="min-h-screen bg-background p-3 text-foreground md:p-4 2xl:p-5">
        <div className="iqon-app-window mx-auto flex h-[calc(100vh-1.5rem)] w-full md:h-[calc(100vh-2rem)] 2xl:h-[calc(100vh-2.5rem)]">
          <DiskAccessSetupPage
            status={systemState?.fullDiskAccessStatus ?? 'unknown'}
            checking={systemStateLoading}
            onOpenSettings={() => {
              void openFullDiskAccessSettings()
            }}
            onRecheck={() => {
              void recheckDiskAccess()
            }}
            onSkip={skipDiskAccessSetup}
          />
        </div>
      </div>
    )
  }

  if (shouldShowMoleSetup) {
    return (
      <div className="min-h-screen bg-background p-3 text-foreground md:p-4 2xl:p-5">
        <div className="iqon-app-window mx-auto flex h-[calc(100vh-1.5rem)] w-full md:h-[calc(100vh-2rem)] 2xl:h-[calc(100vh-2.5rem)]">
          <MoleSetupPage
            status={moleStatus}
            checking={!moleChecked}
            onRecheck={() => {
              void checkMole()
            }}
            onSkip={skipMoleSetup}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      {hudMounted && (
        <div hidden={!isHudRoute} className="min-h-screen bg-background text-foreground">
          <HudPage />
        </div>
      )}
      <div hidden={isHudRoute} className="min-h-screen bg-black p-3 text-foreground md:p-4 2xl:p-5">
        <div className="iqon-app-window mx-auto flex h-[calc(100vh-1.5rem)] w-full md:h-[calc(100vh-2rem)] 2xl:h-[calc(100vh-2.5rem)]">
          <Sidebar />
          <main className="relative min-w-0 flex-1 overflow-y-auto bg-background">
            <div
              className="pointer-events-none absolute inset-0 z-0 opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                backgroundSize: '100px 100px',
              }}
            />
            <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-white opacity-[0.02] blur-[100px]" />
            <div className="relative z-10">
              {showMoleUpdateBanner && (
                <MoleUpdateBanner
                  onOpen={() => navigate('/software-update')}
                  onDismiss={clearMoleUpdate}
                />
              )}
              <AppRoutes />
            </div>
          </main>
        </div>
      </div>
    </>
  )
}

function MoleUpdateBanner({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  const { t } = useI18n()

  return (
    <div className="border-b border-border/70 bg-yellow-500/10 px-4 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-500/15 text-yellow-600 dark:text-clean-yellow">
            <Download className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">{t('moleUpdateBanner.title')}</p>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              {t('moleUpdateBanner.desc')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onOpen}>
            {t('moleUpdateBanner.action')}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label={t('moleUpdateBanner.dismiss')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default App
