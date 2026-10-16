import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function lazyPage<T extends ComponentType>(loader: () => Promise<{ default: T }>) {
  return lazy(loader)
}

const AnalyzePage = lazyPage(() => import('./pages/AnalyzePage').then((module) => ({ default: module.AnalyzePage })))
const AgentCleanupPage = lazyPage(() => import('./pages/AgentCleanupPage').then((module) => ({ default: module.AgentCleanupPage })))
const ApplicationManagementPage = lazyPage(() => import('./pages/ApplicationManagementPage').then((module) => ({ default: module.ApplicationManagementPage })))
const CleanPage = lazyPage(() => import('./pages/CleanPage').then((module) => ({ default: module.CleanPage })))
const DoctorPage = lazyPage(() => import('./pages/DoctorPage').then((module) => ({ default: module.DoctorPage })))
const DuplicatesPage = lazyPage(() => import('./pages/DuplicatesPage').then((module) => ({ default: module.DuplicatesPage })))
const HistoryPage = lazyPage(() => import('./pages/HistoryPage').then((module) => ({ default: module.HistoryPage })))
const HomePage = lazyPage(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const InstallerPage = lazyPage(() => import('./pages/InstallerPage').then((module) => ({ default: module.InstallerPage })))
const IosOrganizePage = lazyPage(() => import('./pages/IosOrganizePage').then((module) => ({ default: module.IosOrganizePage })))
const OptimizePage = lazyPage(() => import('./pages/OptimizePage').then((module) => ({ default: module.OptimizePage })))
const OrganizePage = lazyPage(() => import('./pages/OrganizePage').then((module) => ({ default: module.OrganizePage })))
const PurgePage = lazyPage(() => import('./pages/PurgePage').then((module) => ({ default: module.PurgePage })))
const SettingsPage = lazyPage(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const SoftwareUpdatePage = lazyPage(() => import('./pages/SoftwareUpdatePage').then((module) => ({ default: module.SoftwareUpdatePage })))
const StatisticsPage = lazyPage(() => import('./pages/StatisticsPage').then((module) => ({ default: module.StatisticsPage })))
const StatusPage = lazyPage(() => import('./pages/StatusPage').then((module) => ({ default: module.StatusPage })))

interface KeepAliveRoute {
  path: string
  Component: ComponentType
}

const KEEP_ALIVE_ROUTES: KeepAliveRoute[] = [
  { path: '/', Component: HomePage },
  { path: '/organize', Component: OrganizePage },
  { path: '/ios-organize', Component: IosOrganizePage },
  { path: '/history', Component: HistoryPage },
  { path: '/statistics', Component: StatisticsPage },
  { path: '/duplicates', Component: DuplicatesPage },
  { path: '/clean', Component: CleanPage },
  { path: '/agent-cleanup', Component: AgentCleanupPage },
  { path: '/installers', Component: InstallerPage },
  { path: '/optimize', Component: OptimizePage },
  { path: '/apps', Component: ApplicationManagementPage },
  { path: '/analyze', Component: AnalyzePage },
  { path: '/purge', Component: PurgePage },
  { path: '/status', Component: StatusPage },
  { path: '/doctor', Component: DoctorPage },
  { path: '/software-update', Component: SoftwareUpdatePage },
  { path: '/settings', Component: SettingsPage },
]

const REDIRECT_ROUTES: Record<string, string> = {
  '/deepclean': '/clean',
  '/mole-map': '/',
  '/status-advanced': '/status',
  '/uninstall': '/apps',
}

const PASS_THROUGH_ROUTES = new Set(['/hud'])

export function AppRoutes() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeByPath = useMemo(
    () => new Map(KEEP_ALIVE_ROUTES.map((route) => [route.path, route])),
    []
  )
  const redirectTo = REDIRECT_ROUTES[location.pathname]
  const passThrough = PASS_THROUGH_ROUTES.has(location.pathname)
  const activeRoute = redirectTo || passThrough ? null : routeByPath.get(location.pathname) ?? null
  const activePath = activeRoute?.path ?? null
  const [mountedPaths, setMountedPaths] = useState<string[]>(() => (
    activePath ? [activePath] : []
  ))

  useEffect(() => {
    if (passThrough) return
    if (redirectTo) {
      navigate(redirectTo, { replace: true })
      return
    }
    if (!activeRoute) {
      navigate('/', { replace: true })
    }
  }, [activeRoute, navigate, passThrough, redirectTo])

  useEffect(() => {
    if (!activePath) return
    setMountedPaths((current) => (
      current.includes(activePath) ? current : [...current, activePath]
    ))
  }, [activePath])

  return (
    <>
      {KEEP_ALIVE_ROUTES.filter((route) => mountedPaths.includes(route.path)).map(({ path, Component }) => {
        const active = path === activePath
        return (
          <section key={path} hidden={!active} aria-hidden={!active}>
            <Suspense fallback={null}>
              <Component />
            </Suspense>
          </section>
        )
      })}
    </>
  )
}
