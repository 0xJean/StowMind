import { useI18n } from '@/i18n'
import { buildCleanupActivitySummary } from '@/lib/stowmind-supplements/cleanupActivity'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import {
  Activity,
  AlertCircle,
  Archive,
  BarChart3,
  Copy,
  Download,
  FolderOpen,
  Gauge,
  HardDrive,
  History,
  Home,
  Smartphone,
  PackageSearch,
  PackageX,
  Settings,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { openHudPopover } from '@/pages/hud/native'

type NavItem = {
  path?: string
  action?: () => void
  label: string
  icon?: LucideIcon
  customIcon?: string
}

type NavSection = {
  id: string
  label: string
  items: NavItem[]
}

export function Sidebar() {
  const { t } = useI18n()
  const ollamaOnline = useAppStore((s) => s.ollamaOnline)
  const aiProvider = useAppStore((s) => s.aiProvider)
  const history = useAppStore((s) => s.history)
  const statistics = useAppStore((s) => s.statistics)
  const cleanupActivity = useMemo(
    () => buildCleanupActivitySummary(history, statistics),
    [history, statistics]
  )
  const cleanupBadge = cleanupActivity.executedCount > 0
    ? String(Math.min(cleanupActivity.executedCount, 99))
    : undefined

  const sections = useMemo<NavSection[]>(
    () => [
      {
        id: 'overview',
        label: t('sidebar.group.overview'),
        items: [
          { path: '/', icon: Home, label: t('nav.home') },
        ],
      },
      {
        id: 'cleaning',
        label: t('sidebar.group.cleaning'),
        items: [
          { path: '/clean', icon: Trash2, label: t('nav.clean') },
          { path: '/installers', icon: Archive, label: t('nav.installers') },
          { path: '/purge', icon: PackageX, label: t('nav.purge') },
          { path: '/duplicates', icon: Copy, label: t('nav.duplicates') },
        ],
      },
      {
        id: 'files',
        label: t('sidebar.group.files'),
        items: [
          { path: '/analyze', icon: HardDrive, label: t('nav.analyze') },
          { path: '/organize', icon: FolderOpen, label: t('nav.organize') },
          { path: '/ios-organize', icon: Smartphone, label: t('nav.iosOrganize') },
        ],
      },
      {
        id: 'apps',
        label: t('sidebar.group.apps'),
        items: [
          { path: '/apps', icon: PackageSearch, label: t('nav.apps') },
        ],
      },
      {
        id: 'system',
        label: t('sidebar.group.system'),
        items: [
          { path: '/status', icon: Activity, label: t('nav.status') },
          { path: '/optimize', icon: Zap, label: t('nav.optimize') },
          { path: '/doctor', icon: AlertCircle, label: t('nav.doctor') },
          { path: '/software-update', icon: Download, label: t('nav.softwareUpdate') },
          { action: () => void openHudPopover(), icon: Gauge, label: t('nav.hud') },
        ],
      },
      {
        id: 'records',
        label: t('sidebar.group.records'),
        items: [
          { path: '/history', icon: History, label: t('nav.history') },
          { path: '/statistics', icon: BarChart3, label: t('nav.statistics') },
        ],
      },
    ],
    [t]
  )

  const aiLabel = aiProvider.type === 'ollama'
    ? (ollamaOnline ? t('sidebar.ollamaOnline') : t('sidebar.ollamaOffline'))
    : aiProvider.type === 'local_codex'
      ? 'CODEX CLI'
      : aiProvider.type === 'local_claude_code'
        ? 'CLAUDE CODE'
        : aiProvider.type.toUpperCase()

  return (
    <aside className="app-sidebar flex w-[240px] shrink-0 flex-col border-r border-iqon-border bg-iqon-bg py-6">
      <div className="mb-6 flex items-center gap-2 px-6">
        <img src="/icon.svg" alt="StowMind" className="h-8 w-8" draggable={false} />
        <div className="flex items-center gap-2">
          <div className="text-lg font-bold tracking-tight text-foreground">StowMind</div>
          <span className="iqon-section-label rounded bg-iqon-green/10 px-1.5 py-0.5 text-iqon-green">
            Beta
          </span>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3">
        {sections.map((section) => (
          <div key={section.id} className="mb-4">
            <div className="iqon-section-label mb-2 px-3">{section.label}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const iconEl = item.customIcon ? (
                  <img src={item.customIcon} alt="" className="h-4 w-4 rounded" draggable={false} />
                ) : item.icon ? (
                  <item.icon className="h-4 w-4 shrink-0" />
                ) : null

                if (item.action) {
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.action}
                      className="iqon-nav-item w-full text-left"
                    >
                      {iconEl}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </button>
                  )
                }

                return (
                  <NavLink
                    key={item.path}
                    to={item.path!}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      cn('iqon-nav-item w-full text-left', isActive && 'active')
                    }
                  >
                    {iconEl}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {section.id === 'cleaning' && item.path === '/clean' && cleanupBadge && (
                      <span className="rounded-full bg-iqon-green/15 px-1.5 py-0.5 text-[9px] font-bold text-iqon-green">
                        {cleanupBadge}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-2 px-4">
        <div className="relative overflow-hidden rounded-2xl border border-iqon-border bg-iqon-card p-4">
          <div className="pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-iqon-green opacity-10 blur-xl" />
          <h4 className="relative text-xs font-bold text-foreground">{t('sidebar.systemHealthy')}</h4>
          <p className="relative mt-1 text-[10px] font-medium text-muted-foreground">
            {cleanupActivity.executedCount > 0
              ? t('sidebar.lastCleanCount', { count: cleanupActivity.executedCount })
              : t('sidebar.noCleanYet')}
          </p>
          <NavLink
            to="/clean"
            className="relative mt-3 flex w-full items-center justify-center rounded-xl bg-iqon-green py-1.5 text-[10px] font-bold text-iqon-bg shadow-[0_0_10px_rgba(0,229,153,0.3)] transition-colors hover:brightness-95"
          >
            {t('sidebar.smartScan')}
          </NavLink>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-iqon-border bg-iqon-card px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'iqon-dot',
                ollamaOnline ? 'iqon-dot-green' : 'iqon-dot-red'
              )}
            />
            <span className="text-[10px] font-bold text-muted-foreground">{aiLabel}</span>
          </div>
          <NavLink
            to="/settings"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-iqon-row hover:text-foreground"
            aria-label={t('nav.settings')}
          >
            <Settings className="h-3.5 w-3.5" />
          </NavLink>
        </div>
      </div>
    </aside>
  )
}
