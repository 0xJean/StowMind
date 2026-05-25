import { useI18n } from '@/i18n'
import { cn, formatFileSize } from '@/lib/utils'
import { type HistoryRecord, type HistoryRecordType, useAppStore } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'
import {
  Archive,
  Calendar,
  Copy,
  Loader2,
  PackageSearch,
  PackageX,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'

type StatusFilter = 'all' | 'executed' | 'undone'
type TypeFilter = 'all' | HistoryRecordType
type HistoryTypeKey = `history.type.${HistoryRecordType}`

const HISTORY_TYPE_KEYS: Record<HistoryRecordType, HistoryTypeKey> = {
  organize: 'history.type.organize',
  duplicates: 'history.type.duplicates',
  clean: 'history.type.clean',
  purge: 'history.type.purge',
  installer: 'history.type.installer',
  uninstall: 'history.type.uninstall',
  optimize: 'history.type.optimize',
}

const HISTORY_ICONS: Record<HistoryRecordType, LucideIcon> = {
  organize: Sparkles,
  duplicates: Copy,
  clean: Trash2,
  purge: PackageX,
  installer: Archive,
  uninstall: PackageSearch,
  optimize: Zap,
}

const TYPE_FILTER_ORDER: TypeFilter[] = [
  'all',
  'organize',
  'clean',
  'purge',
  'installer',
  'uninstall',
  'optimize',
  'duplicates',
]

export function HistoryPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const history = useAppStore((s) => s.history)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const markUndone = useAppStore((s) => s.markUndone)
  const removeHistory = useAppStore((s) => s.removeHistory)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  useEffect(() => {
    const st = location.state as { fromOrganize?: boolean } | null
    if (st?.fromOrganize) {
      toast.info(t('history.undoHint'))
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location, navigate, t])

  const filtered = useMemo(() => {
    let list = history
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (r) => {
          const type = r.type ?? 'organize'
          const typeLabel = t(HISTORY_TYPE_KEYS[type]).toLowerCase()
          const cleanupErrors = r.cleanupSummary?.errors ?? []
          return (
            r.directory.toLowerCase().includes(q) ||
            typeLabel.includes(q) ||
            Object.keys(r.categories).some((c) => c.toLowerCase().includes(q)) ||
            cleanupErrors.some((error) => error.toLowerCase().includes(q))
          )
        }
      )
    }
    if (statusFilter === 'executed') {
      list = list.filter((r) => r.executed && !r.undone)
    } else if (statusFilter === 'undone') {
      list = list.filter((r) => r.undone)
    }
    if (typeFilter !== 'all') {
      list = list.filter((r) => (r.type ?? 'organize') === typeFilter)
    }
    return list
  }, [history, search, statusFilter, typeFilter, t])

  const typeCounts = useMemo(() => {
    const counts = new Map<TypeFilter, number>()
    counts.set('all', history.length)
    for (const r of history) {
      const type = (r.type ?? 'organize') as TypeFilter
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    return counts
  }, [history])

  const handleUndo = async (id: string) => {
    const record = history.find((r) => r.id === id)
    if (!record || !record.moves?.length) {
      toast.warn(t('history.undoNoMoves'))
      return
    }
    if (record.undone) {
      toast.info(t('history.undoAlready'))
      return
    }

    const confirmed = window.confirm(t('history.undoConfirm', { n: record.moves.length }))
    if (!confirmed) return

    setUndoingId(id)
    try {
      const errors = await invoke<string[]>('undo_organize', {
        records: record.moves,
      })
      markUndone(id)
      if (errors.length > 0) {
        toast.warn(t('history.undoPartialFail', { n: errors.length }))
        console.warn('Undo errors:', errors)
      } else {
        toast.success(t('history.undoSuccess'))
      }
    } catch (error) {
      toast.error(t('history.undoFail', { error: String(error) }))
    } finally {
      setUndoingId(null)
    }
  }

  const statusButtons: { label: string; value: StatusFilter }[] = [
    { label: t('history.filterAll'), value: 'all' },
    { label: t('history.filterExecuted'), value: 'executed' },
    { label: t('history.filterUndone'), value: 'undone' },
  ]

  const groups = useMemo(
    () => groupByDay(filtered, { today: t('history.today'), yesterday: t('history.yesterday') }),
    [filtered, t]
  )

  return (
    <div className="mx-auto w-full max-w-[1200px] p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.system')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('history.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('history.subtitle')}</p>
        </div>
        {history.length > 0 && (
          <button type="button" className="iqon-btn-secondary" onClick={clearHistory}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('history.clear')}
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('history.searchPlaceholder')}
                className="w-full rounded-xl border border-iqon-border bg-iqon-card py-2 pl-9 pr-4 text-xs text-foreground placeholder:text-muted-foreground focus:border-iqon-borderSoft focus:outline-none"
              />
            </div>
            <div className="flex gap-1 rounded-xl border border-iqon-border bg-iqon-card p-1">
              {statusButtons.map((btn) => (
                <button
                  key={btn.value}
                  type="button"
                  onClick={() => setStatusFilter(btn.value)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-[10px] font-bold transition-colors',
                    statusFilter === btn.value
                      ? 'bg-iqon-green/10 text-iqon-green'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TYPE_FILTER_ORDER.map((value) => {
              const count = typeCounts.get(value) ?? 0
              if (value !== 'all' && count === 0) return null
              const active = typeFilter === value
              const label = value === 'all' ? t('history.filterTypeAll') : t(HISTORY_TYPE_KEYS[value])
              const Icon = value === 'all' ? null : HISTORY_ICONS[value]
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTypeFilter(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-colors',
                    active
                      ? 'border-iqon-green/40 bg-iqon-green/10 text-iqon-green'
                      : 'border-iqon-border bg-iqon-card text-muted-foreground hover:border-iqon-borderSoft hover:text-foreground'
                  )}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {label}
                  <span className="font-mono opacity-70">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={t('history.empty')}
          hint={t('history.emptyHint')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title={t('history.noMatch')} />
      ) : (
        <div className="space-y-8 max-w-3xl">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mb-4 flex items-center gap-3 pl-14">
                <h3 className="iqon-section-label">{group.label}</h3>
                <div className="h-px flex-1 bg-iqon-border" />
              </div>
              <div className="space-y-0">
                {group.records.map((record, idx) => (
                  <TimelineItem
                    key={record.id}
                    record={record}
                    isLast={idx === group.records.length - 1}
                    undoing={undoingId === record.id}
                    onUndo={() => handleUndo(record.id)}
                    onRemove={() => removeHistory(record.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="iqon-card flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
      <Icon className="mb-4 h-10 w-10 opacity-50" />
      <p className="text-sm font-bold text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs">{hint}</p>}
    </div>
  )
}

function groupByDay(
  records: HistoryRecord[],
  labels: { today: string; yesterday: string }
): { label: string; records: HistoryRecord[] }[] {
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000

  const map = new Map<string, { label: string; records: HistoryRecord[]; sortKey: number }>()
  for (const record of records) {
    const ts = new Date(record.timestamp)
    const start = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()).getTime()
    const label =
      start === startOfToday
        ? labels.today
        : start === startOfYesterday
          ? labels.yesterday
          : ts.toLocaleDateString()
    const key = String(start)
    const existing = map.get(key)
    if (existing) {
      existing.records.push(record)
    } else {
      map.set(key, { label, records: [record], sortKey: start })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ label, records: list }) => ({ label, records: list }))
}

type TimelineTone = 'green' | 'cyan' | 'red' | 'yellow' | 'muted'

const TONE_RING: Record<TimelineTone, string> = {
  green: 'bg-iqon-green/10 border-iqon-green/30 text-iqon-green',
  cyan: 'bg-iqon-cyan/10 border-iqon-cyan/30 text-iqon-cyan',
  red: 'bg-iqon-red/10 border-iqon-red/30 text-iqon-red',
  yellow: 'bg-iqon-yellow/10 border-iqon-yellow/30 text-iqon-yellow',
  muted: 'bg-iqon-card border-iqon-border text-foreground',
}

function recordTone(record: HistoryRecord): TimelineTone {
  if (record.undone) return 'muted'
  const type = record.type ?? 'organize'
  if (!record.executed) return 'yellow'
  if (type === 'clean' || type === 'purge' || type === 'uninstall') return 'red'
  if (type === 'optimize') return 'green'
  if (type === 'duplicates') return 'cyan'
  return 'green'
}

function TimelineItem({
  record,
  isLast,
  undoing,
  onUndo,
  onRemove,
}: {
  record: HistoryRecord
  isLast: boolean
  undoing: boolean
  onUndo: () => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const type = record.type ?? 'organize'
  const TypeIcon = HISTORY_ICONS[type]
  const canUndo =
    type === 'organize' && record.executed && !record.undone && (record.moves?.length ?? 0) > 0
  const cleanupErrors = record.cleanupSummary?.errors ?? []
  const isPreview = record.cleanupSummary?.action === 'preview' || !record.executed
  const tone = recordTone(record)
  const totalSize = record.cleanupSummary?.totalSize
  const itemCount = type === 'organize' ? record.totalFiles : record.cleanupSummary?.itemCount ?? record.totalFiles
  const timeStr = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={cn('relative pl-14 pb-6', record.undone && 'opacity-60')}>
      {!isLast && (
        <div className="absolute left-[23px] top-10 bottom-0 w-px bg-iqon-border" />
      )}
      <div
        className={cn(
          'absolute left-0 top-1 z-10 flex h-12 w-12 items-center justify-center rounded-xl border',
          TONE_RING[tone]
        )}
      >
        <TypeIcon className="h-4 w-4" />
      </div>

      <div className="iqon-card iqon-card-hover p-4">
        <div className="mb-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="truncate text-sm font-bold text-foreground">{record.directory}</h4>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{t(HISTORY_TYPE_KEYS[type])}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded bg-iqon-row px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {timeStr}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                record.undone
                  ? 'bg-iqon-row text-muted-foreground'
                  : record.executed
                    ? 'bg-iqon-green/10 text-iqon-green'
                    : 'bg-iqon-yellow/10 text-iqon-yellow'
              )}
            >
              {record.undone
                ? t('history.statusUndone')
                : record.executed
                  ? t('history.statusExecuted')
                  : t('history.statusPreview')}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {type === 'organize'
            ? t('history.nFiles', { n: itemCount })
            : t('history.nItems', { n: itemCount })}
          {type !== 'organize' && typeof totalSize === 'number' && (
            <>
              {' · '}
              <span className="font-bold text-foreground">
                {t(isPreview ? 'history.spacePotential' : 'history.spaceFreed', {
                  size: formatFileSize(totalSize),
                })}
              </span>
            </>
          )}
        </p>
        {Object.keys(record.categories).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(record.categories).map(([cat, count]) => (
              <span
                key={cat}
                className="rounded-md border border-iqon-border bg-iqon-row px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground"
              >
                {cat}: {count}
              </span>
            ))}
          </div>
        )}
        {record.organizeErrors && record.organizeErrors.length > 0 && (
          <p className="mt-2 whitespace-pre-wrap text-[10px] text-iqon-yellow">
            {t('history.partialErrors')}: {record.organizeErrors.length}
          </p>
        )}
        {cleanupErrors.length > 0 && (
          <p className="mt-2 whitespace-pre-wrap text-[10px] text-iqon-yellow">
            {t('history.cleanupErrors')}: {cleanupErrors.length}
          </p>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={undoing}
              className="iqon-btn-secondary disabled:opacity-50"
            >
              {undoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
              {t('history.undo')}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-iqon-row hover:text-iqon-red"
            aria-label={t('history.clear')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
