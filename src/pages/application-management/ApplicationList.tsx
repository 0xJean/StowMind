import { useI18n } from '@/i18n'
import { cn, formatFileSize } from '@/lib/utils'
import { CheckCircle2, Circle, Package, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { prefetchAppIcons, useAppIconDataUrl } from './appIconLoader'
import type { ManagedAppRow } from './types'

interface Props {
  rows: ManagedAppRow[]
  selectedPath?: string
  onSelect: (row: ManagedAppRow) => void
  onReveal: (path: string) => void
  onUpdateAction: (row: ManagedAppRow) => void
  updatingPath?: string | null
}

export function ApplicationList({ rows, selectedPath, onSelect, onReveal, onUpdateAction, updatingPath }: Props) {
  const { t } = useI18n()

  useEffect(() => {
    prefetchAppIcons(rows.map((row) => row.uninstall.path))
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="stow-panel flex h-[30rem] items-center justify-center text-sm font-semibold text-muted-foreground">
        {t('apps.noResults')}
      </div>
    )
  }

  return (
    <div className="stow-list-shell">
      <div className="hidden grid-cols-[minmax(0,1.8fr)_0.7fr_0.7fr_0.55fr_6.5rem] gap-3 stow-list-header lg:grid">
        <span>{t('apps.column.app')}</span>
        <span>{t('apps.column.update')}</span>
        <span>{t('apps.column.source')}</span>
        <span className="text-right">{t('apps.column.size')}</span>
        <span />
      </div>
      <div className="h-[calc(100vh-31rem)] min-h-[30rem] overflow-y-auto p-2">
        <div className="space-y-1">
        {rows.map((row, index) => {
          const item = row.uninstall
          const selected = selectedPath === item.path
          return (
            <div
              key={`${item.path}-${item.uninstall_name}`}
              role="button"
              tabIndex={0}
              className={cn(
                'grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:grid-cols-[minmax(0,1.8fr)_0.7fr_0.7fr_0.55fr_6.5rem]',
                selected ? 'bg-primary/10 ring-1 ring-primary/25' : 'hover:bg-surface-hover'
              )}
              onClick={() => onSelect(row)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(row)
                }
              }}
              onDoubleClick={() => onReveal(item.path)}
            >
              <div className="flex min-w-0 items-center gap-4">
                <LazyAppIcon
                  fallbackIconDataUrl={item.icon_data_url}
                  name={item.name}
                  path={item.path}
                  index={index}
                />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-bold text-foreground md:text-[15px]">{item.name}</p>
                    {row.update?.updateStatus === 'available' && (
                      <span className="inline-flex items-center rounded-full border border-yellow-400/30 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-bold text-yellow-700 dark:text-yellow-300">
                        <Sparkles className="mr-1 h-3 w-3" />
                        {t('apps.status.available')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                    {buildMeta(row.update?.installedVersion, item.bundle_id, item.path)}
                  </p>
                </div>
              </div>
              <StatusBadge status={row.update?.updateStatus} />
              <span className="hidden truncate text-xs font-semibold text-muted-foreground lg:block">{item.source || 'unknown'}</span>
              <span className="hidden text-right font-mono text-xs font-semibold text-muted-foreground lg:block">{formatFileSize(item.size_bytes)}</span>
              <div className="flex items-center justify-end gap-2">
                {row.update?.updateStatus === 'available' && row.update.actionKind && row.update.actionTarget && (
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-xl border border-primary/30 bg-primary/10 px-3 text-xs font-bold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation()
                      onUpdateAction(row)
                    }}
                  >
                    {updatingPath === item.path ? t('apps.updatingAction') : row.update.actionLabel || t('apps.updateAction')}
                  </button>
                )}
                {selected ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground/45" />
                )}
              </div>
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}

function LazyAppIcon({
  fallbackIconDataUrl,
  name,
  path,
  index,
}: {
  fallbackIconDataUrl?: string | null
  name: string
  path: string
  index: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const iconDataUrl = useAppIconDataUrl(path, fallbackIconDataUrl, visible)

  useEffect(() => {
    if (visible || fallbackIconDataUrl) return
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '240px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [fallbackIconDataUrl, visible])

  return (
    <div ref={containerRef} className="h-10 w-10 shrink-0">
      <AppIcon iconDataUrl={iconDataUrl} name={name} index={index} />
    </div>
  )
}

function AppIcon({ iconDataUrl, name, index }: { iconDataUrl?: string | null; name: string; index: number }) {
  if (iconDataUrl) {
    return (
      <img
        src={iconDataUrl}
        alt=""
        className="h-10 w-10 rounded-xl object-contain"
        draggable={false}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-soft',
        index % 2 === 0 ? 'border-primary/20 bg-primary/10 text-primary' : 'border-border/70 bg-surface-hover text-muted-foreground'
      )}
      aria-hidden="true"
      title={name}
    >
      <Package className="h-4 w-4" />
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  const { t } = useI18n()
  if (status === 'available') {
    return (
      <span className="hidden w-fit rounded-full border border-yellow-400/30 bg-yellow-500/10 px-2 py-1 text-xs font-bold text-yellow-700 dark:text-yellow-300 lg:inline-flex">
        {t('apps.status.available')}
      </span>
    )
  }
  if (status === 'current') {
    return (
      <span className="hidden w-fit rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 lg:inline-flex">
        {t('apps.status.current')}
      </span>
    )
  }
  if (status === 'checking') {
    return (
      <span className="hidden w-fit rounded-full border border-border/70 bg-surface-hover px-2 py-1 text-xs font-bold text-muted-foreground lg:inline-flex">
        {t('apps.status.checking')}
      </span>
    )
  }
  return (
    <span className="hidden w-fit rounded-full border border-border/70 bg-card px-2 py-1 text-xs font-bold text-muted-foreground lg:inline-flex">
      {t('apps.status.manageOnly')}
    </span>
  )
}

function buildMeta(version: string | null | undefined, bundleId: string, path: string) {
  const parts = [version, bundleId || path].filter(Boolean)
  if (parts.length === 0) return '—'
  return parts.join('  ')
}
