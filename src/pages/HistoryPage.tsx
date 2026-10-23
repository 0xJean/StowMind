import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { type HistoryRecord, useAppStore } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'
import {
  Calendar,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { MoleHistoryPanel } from './history/MoleHistoryPanel'
import { TimelineItem } from './history/HistoryTimelineItem'
import { HISTORY_ICONS, HISTORY_TYPE_KEYS, TYPE_FILTER_ORDER, type TypeFilter } from './history/historyPresentation'

type StatusFilter = 'all' | 'executed' | 'undone'
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
          const riskNotes = r.cleanupSummary?.riskNotes ?? []
          return (
            r.directory.toLowerCase().includes(q) ||
            typeLabel.includes(q) ||
            Object.keys(r.categories).some((c) => c.toLowerCase().includes(q)) ||
            cleanupErrors.some((error) => error.toLowerCase().includes(q)) ||
            riskNotes.some((note) => note.toLowerCase().includes(q))
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

      <MoleHistoryPanel />

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
