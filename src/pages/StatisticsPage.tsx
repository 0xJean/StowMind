import { useI18n } from '@/i18n'
import { cn, formatDate, formatFileSize } from '@/lib/utils'
import { useAppStore, type HistoryRecord, type HistoryRecordType } from '@/stores/app'
import {
  Archive,
  BarChart3,
  CalendarDays,
  Copy,
  FolderOpen,
  HardDrive,
  PackageX,
  Sparkles,
  TrendingUp,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'

type Tone = 'green' | 'cyan' | 'purple' | 'yellow' | 'red'

const TONE: Record<Tone, { text: string; glow: string; mesh: string; bar: string }> = {
  green: { text: 'text-iqon-green', glow: 'bg-iqon-green', mesh: 'text-iqon-green/40', bar: 'bg-iqon-green' },
  cyan: { text: 'text-iqon-cyan', glow: 'bg-iqon-cyan', mesh: 'text-iqon-cyan/40', bar: 'bg-iqon-cyan' },
  purple: { text: 'text-iqon-purple', glow: 'bg-iqon-purple', mesh: 'text-iqon-purple/40', bar: 'bg-iqon-purple' },
  yellow: { text: 'text-iqon-yellow', glow: 'bg-iqon-yellow', mesh: 'text-iqon-yellow/40', bar: 'bg-iqon-yellow' },
  red: { text: 'text-iqon-red', glow: 'bg-iqon-red', mesh: 'text-iqon-red/40', bar: 'bg-iqon-red' },
}

interface TypeMeta {
  type: HistoryRecordType
  icon: LucideIcon
  tone: Tone
}

const TYPE_META: TypeMeta[] = [
  { type: 'organize', icon: Sparkles, tone: 'green' },
  { type: 'clean', icon: Trash2, tone: 'red' },
  { type: 'purge', icon: PackageX, tone: 'yellow' },
  { type: 'installer', icon: Archive, tone: 'cyan' },
  { type: 'uninstall', icon: PackageX, tone: 'purple' },
  { type: 'optimize', icon: Zap, tone: 'green' },
  { type: 'duplicates', icon: Copy, tone: 'cyan' },
]

function isExecuted(record: HistoryRecord) {
  return record.executed && !record.undone
}

function recordSize(record: HistoryRecord) {
  return record.cleanupSummary?.totalSize ?? 0
}

function recordItemCount(record: HistoryRecord) {
  const type = record.type ?? 'organize'
  if (type === 'organize') return record.totalFiles
  return record.cleanupSummary?.itemCount ?? record.totalFiles
}

export function StatisticsPage() {
  const { t } = useI18n()
  const statistics = useAppStore((s) => s.statistics)
  const history = useAppStore((s) => s.history)
  const categories = useAppStore((s) => s.categories)

  const executedHistory = useMemo(() => history.filter(isExecuted), [history])

  const byType = useMemo(() => {
    const map = new Map<HistoryRecordType, { count: number; freed: number; items: number; latest?: string }>()
    for (const record of executedHistory) {
      const type = record.type ?? 'organize'
      const current = map.get(type) ?? { count: 0, freed: 0, items: 0 }
      current.count += 1
      current.freed += recordSize(record)
      current.items += recordItemCount(record)
      if (!current.latest || record.timestamp > current.latest) current.latest = record.timestamp
      map.set(type, current)
    }
    return map
  }, [executedHistory])

  const totalFreed = Array.from(byType.values()).reduce((sum, v) => sum + v.freed, 0)
  const totalOps = executedHistory.length
  const totalFilesOrganized = statistics.totalFilesOrganized

  const recentDays = useMemo(() => {
    const days: { label: string; total: number; byType: Map<HistoryRecordType, number> }[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const dayRecords = executedHistory.filter((r) => r.timestamp.slice(0, 10) === dateStr)
      const typeMap = new Map<HistoryRecordType, number>()
      for (const r of dayRecords) {
        const type = r.type ?? 'organize'
        typeMap.set(type, (typeMap.get(type) ?? 0) + 1)
      }
      days.push({
        label: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
        total: dayRecords.length,
        byType: typeMap,
      })
    }
    return days
  }, [executedHistory])

  const maxDayTotal = Math.max(...recentDays.map((d) => d.total), 1)
  const totalCategoryCount = Object.values(statistics.categoryCounts).reduce((a, b) => a + b, 0)

  const sortedCategories = useMemo(() => {
    return categories
      .map((cat) => ({
        ...cat,
        count: statistics.categoryCounts[cat.name] || 0,
      }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [categories, statistics.categoryCounts])

  const maxCategoryCount = sortedCategories.length > 0 ? sortedCategories[0].count : 0

  return (
    <div className="stow-page-wide">
      <div>
        <p className="iqon-eyebrow mb-1">{t('eyebrow.insights')}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('stats.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('stats.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HeroCard
          tone="green"
          icon={HardDrive}
          eyebrow={t('stats.heroSpaceTitle')}
          value={formatFileSize(totalFreed)}
          detail={t('stats.heroSpaceDesc')}
        />
        <HeroCard
          tone="cyan"
          icon={FolderOpen}
          eyebrow={t('stats.heroOrganizedTitle')}
          value={String(totalFilesOrganized)}
          detail={t('stats.heroOrganizedDesc')}
        />
        <HeroCard
          tone="purple"
          icon={Sparkles}
          eyebrow={t('stats.heroOpsTitle')}
          value={String(totalOps)}
          detail={t('stats.heroOpsDesc')}
        />
      </div>

      <div className="iqon-card p-5">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-foreground">{t('stats.byTypeTitle')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('stats.byTypeDesc')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {TYPE_META.map((meta) => {
            const stat = byType.get(meta.type)
            return (
              <TypeBreakdownTile
                key={meta.type}
                meta={meta}
                label={t(`history.type.${meta.type}` as Parameters<typeof t>[0])}
                stat={stat}
                t={t}
              />
            )
          })}
        </div>
      </div>

      <div className="iqon-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-iqon-cyan" />
          <div>
            <h3 className="text-sm font-bold text-foreground">{t('stats.activityTitle')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('stats.activityDesc')}</p>
          </div>
        </div>
        <div className="flex h-44 items-end justify-between gap-2">
          {recentDays.map((day) => (
            <div key={day.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-bold tabular-nums text-foreground">{day.total || ''}</span>
              <div className="flex w-full max-w-12 items-end justify-center" style={{ height: '120px' }}>
                <DayBar day={day} maxTotal={maxDayTotal} />
              </div>
              <span className="text-[10px] text-muted-foreground">{day.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-iqon-border pt-3 text-xs">
          <span className="text-muted-foreground">
            {t('stats.last7daysSummary')}{' '}
            <span className="font-bold text-foreground">
              {t('stats.nOps', { n: recentDays.reduce((s, d) => s + d.total, 0) })}
            </span>
          </span>
          <div className="flex flex-wrap gap-2">
            {TYPE_META.map((meta) => (
              <Legend key={meta.type} meta={meta} label={t(`history.type.${meta.type}` as Parameters<typeof t>[0])} />
            ))}
          </div>
        </div>
      </div>

      {totalCategoryCount > 0 && (
        <div className="iqon-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-iqon-green" />
            <div>
              <h3 className="text-sm font-bold text-foreground">{t('stats.categoryRank')}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('stats.nFiles', { n: totalCategoryCount })}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {sortedCategories.map((cat) => {
              const percentage = (cat.count / totalCategoryCount) * 100
              const barWidth = (cat.count / maxCategoryCount) * 100
              return (
                <div key={cat.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{cat.icon}</span>
                      <span className="font-bold text-foreground">{cat.name}</span>
                    </div>
                    <span className="font-mono text-muted-foreground tabular-nums">
                      {cat.count} · {percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-iqon-row">
                    <div
                      className="h-full rounded-full bg-iqon-green transition-all duration-500"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function HeroCard({
  tone,
  icon: Icon,
  eyebrow,
  value,
  detail,
}: {
  tone: Tone
  icon: LucideIcon
  eyebrow: string
  value: string
  detail: string
}) {
  const tt = TONE[tone]
  return (
    <div className="iqon-card relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className={cn('absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-[0.18] blur-[50px]', tt.glow)} />
        <div className={cn('iqon-mesh-soft absolute inset-0', tt.mesh)} />
      </div>
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="iqon-eyebrow">{eyebrow}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-iqon-border bg-iqon-row">
            <Icon className={cn('h-5 w-5', tt.text)} />
          </span>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function TypeBreakdownTile({
  meta,
  label,
  stat,
  t,
}: {
  meta: TypeMeta
  label: string
  stat: { count: number; freed: number; items: number; latest?: string } | undefined
  t: ReturnType<typeof useI18n>['t']
}) {
  const tt = TONE[meta.tone]
  const Icon = meta.icon
  const empty = !stat || stat.count === 0
  return (
    <div className={cn('iqon-row p-4', empty && 'opacity-60')}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-iqon-border bg-iqon-card">
          <Icon className={cn('h-4 w-4', tt.text)} />
        </span>
        <p className="truncate text-xs font-bold text-foreground">{label}</p>
      </div>
      {empty ? (
        <p className="text-[11px] text-muted-foreground">{t('stats.typeNever')}</p>
      ) : (
        <>
          <p className={cn('text-2xl font-bold tabular-nums', tt.text)}>{stat.count}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{t('stats.typeOps', { n: stat.count })}</p>
          {stat.freed > 0 && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t('stats.typeFreed', { size: formatFileSize(stat.freed) })}
            </p>
          )}
          {meta.type === 'organize' && stat.items > 0 && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('stats.typeFiles', { n: stat.items })}
            </p>
          )}
          {stat.latest && (
            <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              <span className="truncate">{formatDate(stat.latest).split(' ')[0]}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DayBar({
  day,
  maxTotal,
}: {
  day: { total: number; byType: Map<HistoryRecordType, number> }
  maxTotal: number
}) {
  const heightPct = day.total > 0 ? Math.max((day.total / maxTotal) * 100, 8) : 2
  if (day.total === 0) {
    return (
      <div
        className="w-full rounded-t bg-iqon-row"
        style={{ height: `${heightPct}%` }}
      />
    )
  }
  return (
    <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${heightPct}%` }}>
      {TYPE_META.map((meta) => {
        const count = day.byType.get(meta.type) ?? 0
        if (count === 0) return null
        const segPct = (count / day.total) * 100
        return (
          <div
            key={meta.type}
            className={cn(TONE[meta.tone].bar, 'transition-all duration-300')}
            style={{ height: `${segPct}%` }}
          />
        )
      })}
    </div>
  )
}

function Legend({ meta, label }: { meta: TypeMeta; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className={cn('h-2 w-2 rounded-sm', TONE[meta.tone].bar)} />
      {label}
    </span>
  )
}
