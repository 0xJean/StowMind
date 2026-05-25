import { useI18n } from '@/i18n'
import { cn, formatFileSize } from '@/lib/utils'
import { ExternalLink, RefreshCw, Search, Trash2, type LucideIcon } from 'lucide-react'
import { useEffect, type MouseEvent } from 'react'
import type { MoleAnalyzeEntry } from './types'

export interface AnalyzeContextMenuState {
  x: number
  y: number
  entry: MoleAnalyzeEntry
}

export function AnalyzeContextMenu({
  menu,
  onClose,
  onOpen,
  onReveal,
  onRetry,
  onTrash,
}: {
  menu: AnalyzeContextMenuState | null
  onClose: () => void
  onOpen: (entry: MoleAnalyzeEntry) => void
  onReveal: (entry: MoleAnalyzeEntry) => void
  onRetry: (entry: MoleAnalyzeEntry) => void
  onTrash: (entry: MoleAnalyzeEntry) => void
}) {
  const { t } = useI18n()

  useEffect(() => {
    if (!menu) return
    const handleClick = () => onClose()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [menu, onClose])

  if (!menu) return null

  const run = (action: (entry: MoleAnalyzeEntry) => void) => {
    action(menu.entry)
    onClose()
  }

  return (
    <div
      className="fixed z-50 w-64 overflow-hidden rounded-2xl border border-iqon-border bg-popover p-1 text-popover-foreground shadow-clean"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <p
        className="iqon-eyebrow truncate border-b border-iqon-border px-3 py-2 font-mono"
        title={menu.entry.path}
      >
        {menu.entry.path}
      </p>
      <ContextAction icon={Search} label={t('analyze.context.open')} onClick={() => run(onOpen)} />
      <ContextAction icon={ExternalLink} label={t('analyze.context.reveal')} onClick={() => run(onReveal)} />
      <ContextAction icon={RefreshCw} label={t('analyze.context.retry')} onClick={() => run(onRetry)} />
      <ContextAction
        icon={Trash2}
        label={t('analyze.context.trash')}
        onClick={() => run(onTrash)}
        destructive
      />
      <p className="px-3 py-2 text-[10px] text-muted-foreground">{t('analyze.context.supplementNote')}</p>
    </div>
  )
}

function ContextAction({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors hover:bg-iqon-row',
        destructive ? 'text-iqon-red hover:text-iqon-red' : 'text-foreground'
      )}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

export function AnalyzeRow({
  entry,
  total,
  t,
  onOpen,
  onReveal,
  onContextMenu,
}: {
  entry: MoleAnalyzeEntry
  total: number
  t: ReturnType<typeof useI18n>['t']
  onOpen: () => void
  onReveal: () => void
  onContextMenu: (event: MouseEvent) => void
}) {
  const percent = total > 0 ? Math.round((entry.size / total) * 100) : 0
  const tone = entry.is_dir ? 'text-iqon-cyan' : 'text-iqon-purple'
  const barTone = entry.is_dir ? 'bg-iqon-cyan' : 'bg-iqon-purple'
  return (
    <div className="iqon-row iqon-row-hover p-3" onContextMenu={onContextMenu}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('iqon-pill text-[9px]', tone, 'border-current')}>
              {entry.is_dir ? t('analyze.kindFolder') : t('analyze.kindFile')}
            </span>
            <span className="truncate text-xs font-bold text-foreground">{entry.name}</span>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{entry.path}</p>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs font-bold tabular-nums text-foreground">
            {formatFileSize(entry.size)}
          </span>
          <button
            type="button"
            onClick={onReveal}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-iqon-card hover:text-foreground"
            aria-label={t('analyze.context.reveal')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-iqon-border">
          <div
            className={cn('h-full rounded-full transition-all', barTone)}
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
        <span className="w-10 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
          {percent}%
        </span>
      </div>
    </div>
  )
}
