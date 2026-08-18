import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnalyzePage } from './pages/AnalyzePage'
import { ApplicationManagementPage } from './pages/ApplicationManagementPage'
import { CleanPage } from './pages/CleanPage'
import { DoctorPage } from './pages/DoctorPage'
import { DuplicatesPage } from './pages/DuplicatesPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { InstallerPage } from './pages/InstallerPage'
import { IosOrganizePage } from './pages/IosOrganizePage'
import { OptimizePage } from './pages/OptimizePage'
import { OrganizePage } from './pages/OrganizePage'
import { PurgePage } from './pages/PurgePage'
import { SettingsPage } from './pages/SettingsPage'
import { SoftwareUpdatePage } from './pages/SoftwareUpdatePage'
import { StatisticsPage } from './pages/StatisticsPage'
import { StatusPage } from './pages/StatusPage'

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
            <Component />
          </section>
        )
      })}
    </>
  )
}
