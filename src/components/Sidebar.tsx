import { useTheme } from '@/hooks/useTheme'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { BarChart3, FolderOpen, History, Home, Moon, Settings, Sun } from 'lucide-react'
import { NavLink } from 'react-router-dom'

export function Sidebar() {
  const { t } = useI18n()
  const { resolved, setTheme } = useTheme()
  const ollamaOnline = useAppStore((s) => s.ollamaOnline)
  const aiProvider = useAppStore((s) => s.aiProvider)

  const navItems = [
    { path: '/', icon: Home, label: t('nav.home') },
    { path: '/organize', icon: FolderOpen, label: t('nav.organize') },
    { path: '/history', icon: History, label: t('nav.history') },
    { path: '/statistics', icon: BarChart3, label: t('nav.statistics') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
  ]

  return (
    <aside className="w-52 bg-card border-r border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <img
            src="/icon.svg"
            alt="StowMind"
            className="w-9 h-9 rounded-xl"
            draggable={false}
          />
          <div className="leading-tight">
            <div className="font-semibold text-base">StowMind</div>
            <div className="text-xs text-muted-foreground">AI file organizer</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                ollamaOnline ? 'bg-green-500' : 'bg-red-500'
              )}
            />
            <span className="text-muted-foreground">
              {aiProvider.type === 'ollama'
                ? (ollamaOnline ? t('sidebar.ollamaOnline') : t('sidebar.ollamaOffline'))
                : aiProvider.type.toUpperCase()
              }
            </span>
          </div>
          <button
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
          >
            {resolved === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  )
}
