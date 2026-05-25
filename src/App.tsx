import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { Download, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { Button } from './components/ui/button'
import { Sidebar } from './components/Sidebar'
import { useDashboardCacheSync } from './hooks/useDashboardCacheSync'
import { useI18n } from './i18n'
import { checkMoleInstallation, fallbackMoleStatus } from './lib/mole'
import { resultCacheKeys, saveResultSnapshot } from './lib/resultCache'
import { AnalyzePage } from './pages/AnalyzePage'
import { CleanPage } from './pages/CleanPage'
import { DoctorPage } from './pages/DoctorPage'
import { DuplicatesPage } from './pages/DuplicatesPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { HudPage } from './pages/HudPage'
import { loadHudSettings } from './pages/hud/settings'
import { InstallerPage } from './pages/InstallerPage'
import { OptimizePage } from './pages/OptimizePage'
import { OrganizePage } from './pages/OrganizePage'
import { PurgePage } from './pages/PurgePage'
import { StatusPage } from './pages/StatusPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { SoftwareUpdatePage } from './pages/SoftwareUpdatePage'
import { ApplicationManagementPage } from './pages/ApplicationManagementPage'
import type { MoleDoctorResult } from './pages/mole/doctorTypes'
import { MoleSetupPage } from './pages/onboarding/MoleSetupPage'
import { useAppStore } from './stores/app'
import { useMoleStore } from './stores/mole'

interface WatchFolderChangePayload {
  paths: string[]
  kind: string
}

const LAST_ROUTE_KEY = 'stowmind.lastRoute.v1'
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
  const [moleSetupPreference, setMoleSetupPreference] = useState<'done' | 'skipped' | null>(() => {
    const saved = localStorage.getItem(MOLE_SETUP_KEY)
    return saved === 'done' || saved === 'skipped' ? saved : null
  })

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
    if (moleChecked) return
    void checkMole()
  }, [checkMole, moleChecked])

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
  }, [watchFolderEnabled, watchFolderPathsText])

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

  const isHudRoute = location.pathname === '/hud'
  const shouldShowMoleSetup =
    moleSetupPreference !== 'skipped' &&
    (moleStatus?.installed === false || (!moleChecked && moleSetupPreference !== 'done'))
  const showMoleUpdateBanner =
    !isHudRoute &&
    location.pathname !== '/software-update' &&
    moleUpdate.checked &&
    moleUpdate.available

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

  if (isHudRoute) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <HudPage />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black p-3 text-foreground md:p-4 2xl:p-5">
      <div className="iqon-app-window mx-auto flex h-[calc(100vh-1.5rem)] w-full md:h-[calc(100vh-2rem)] 2xl:h-[calc(100vh-2.5rem)]">
      {!isHudRoute && <Sidebar />}
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
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/organize" element={<OrganizePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
          <Route path="/duplicates" element={<DuplicatesPage />} />
          <Route path="/clean" element={<CleanPage />} />
          <Route path="/installers" element={<InstallerPage />} />
          <Route path="/optimize" element={<OptimizePage />} />
          <Route path="/uninstall" element={<ApplicationManagementPage />} />
          <Route path="/apps" element={<ApplicationManagementPage />} />
          <Route path="/analyze" element={<AnalyzePage />} />
          <Route path="/purge" element={<PurgePage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/status-advanced" element={<Navigate to="/status" replace />} />
          <Route path="/doctor" element={<DoctorPage />} />
          <Route path="/software-update" element={<SoftwareUpdatePage />} />
          <Route path="/hud" element={<HudPage />} />
          <Route path="/mole-map" element={<Navigate to="/" replace />} />
          <Route path="/deepclean" element={<Navigate to="/clean" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
      </main>
      </div>
    </div>
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
