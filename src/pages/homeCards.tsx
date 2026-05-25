import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { HistoryRecord } from '@/stores/app'
import { Activity, Archive, ArrowRight, Copy, Cpu, History, PackageSearch, PackageX, Sparkles, Trash2, Zap, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type ToneKey = 'green' | 'cyan' | 'purple' | 'red' | 'yellow'

export const TONE_CLASSES: Record<ToneKey, { dot: string; ring: string; glow: string; text: string; mesh: string }> = {
  green: { dot: 'iqon-dot-green', ring: 'stroke-iqon-green', glow: 'bg-iqon-green', text: 'text-iqon-green', mesh: 'text-iqon-green/40' },
  cyan: { dot: 'iqon-dot-cyan', ring: 'stroke-iqon-cyan', glow: 'bg-iqon-cyan', text: 'text-iqon-cyan', mesh: 'text-iqon-cyan/40' },
  purple: { dot: 'iqon-dot-purple', ring: 'stroke-iqon-purple', glow: 'bg-iqon-purple', text: 'text-iqon-purple', mesh: 'text-iqon-purple/45' },
  red: { dot: 'iqon-dot-red', ring: 'stroke-iqon-red', glow: 'bg-iqon-red', text: 'text-iqon-red', mesh: 'text-iqon-red/40' },
  yellow: { dot: 'iqon-dot-yellow', ring: 'stroke-iqon-yellow', glow: 'bg-iqon-yellow', text: 'text-iqon-yellow', mesh: 'text-iqon-yellow/40' },
}

export function GroupSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        <p className="iqon-eyebrow">{label}</p>
        <div className="h-px flex-1 bg-iqon-border" />
      </div>
      <div className="grid auto-rows-[minmax(120px,auto)] grid-cols-12 gap-4">{children}</div>
    </div>
  )
}

export function MetricCard({
  tone, title, subtitle, status, icon: Icon, value, progressLabel, progressValue, colSpan, onClick,
}: {
  tone: ToneKey
  title: string
  subtitle: string
  status: string
  icon: typeof Cpu
  value: string
  progressLabel: string
  progressValue: number
  colSpan: number
  onClick: () => void
}) {
  const dashLength = 251.2
  const arc = (progressValue / 100) * dashLength
  const tt = TONE_CLASSES[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'iqon-card iqon-card-hover group relative flex flex-col justify-between overflow-hidden p-4 text-left',
        colSpan === 2 && 'col-span-12 md:col-span-6 xl:col-span-2',
        colSpan === 3 && 'col-span-12 md:col-span-6 xl:col-span-3'
      )}
    >
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className={cn('absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-[0.16] blur-[40px]', tt.glow)} />
        <div className={cn('iqon-mesh-soft absolute inset-0', tt.mesh)} />
      </div>
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{subtitle}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <span className={cn('iqon-dot', tt.dot)} />
            <span className="text-[10px] font-bold text-foreground">{status}</span>
          </div>
        </div>
        <div className="relative h-12 w-12 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-[225deg]">
            <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth={8} fill="none"
              strokeDasharray={`188.5 ${dashLength}`} strokeLinecap="round" className="text-iqon-border" />
            <circle cx="50" cy="50" r="40" strokeWidth={8} fill="none"
              strokeDasharray={`${arc} ${dashLength}`} strokeLinecap="round" className={tt.ring} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon className={cn('h-4 w-4', tt.text)} />
          </div>
        </div>
      </div>
      <div className="relative z-10 mt-3">
        <div className="mb-1.5 flex justify-between text-[10px] text-muted-foreground">
          <span>{progressLabel}</span>
          <span>{value}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-iqon-border">
          <div className={cn('h-full rounded-full', tt.glow)} style={{ width: `${progressValue}%` }} />
        </div>
      </div>
    </button>
  )
}

export function ActionCard({
  tone, title, subtitle, status, cta, onClick, pulse, icon: Icon, colSpan = 4,
}: {
  tone: ToneKey
  title: string
  subtitle: string
  status: string
  cta: string
  onClick: () => void
  pulse?: boolean
  icon?: LucideIcon
  colSpan?: 3 | 4
}) {
  const tt = TONE_CLASSES[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'iqon-card iqon-card-hover group relative col-span-12 flex flex-col justify-between overflow-hidden p-5 text-left',
        colSpan === 3 ? 'md:col-span-6 xl:col-span-3' : 'md:col-span-6 xl:col-span-4'
      )}
    >
      <div className="relative z-10">
        <div className="mb-2 flex items-center gap-2">
          {Icon ? <Icon className={cn('h-4 w-4', tt.text)} /> : null}
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <span className={cn('iqon-dot', tt.dot, pulse && 'animate-pulse')} />
          <span className="text-[10px] font-bold text-foreground">{status}</span>
        </div>
      </div>
      <div className="relative z-10 mt-6">
        <span className="inline-flex items-center gap-1 rounded-lg border border-iqon-borderSoft bg-iqon-border px-3 py-1.5 text-[10px] font-bold text-foreground transition-colors group-hover:bg-iqon-borderSoft">
          {cta} <ArrowRight className="h-3 w-3" />
        </span>
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className={cn('absolute -bottom-10 -right-10 h-44 w-44 rounded-full opacity-[0.22] blur-[50px]', tt.glow)} />
        <div className={cn('iqon-mesh-center absolute inset-0', tt.mesh)} />
      </div>
    </button>
  )
}

export function RecentActivityCard({ history, onSeeAll }: { history: HistoryRecord[]; onSeeAll: () => void }) {
  const { t } = useI18n()
  const recent = history.slice(0, 3)
  return (
    <div className="iqon-card relative col-span-12 flex flex-col p-5 md:col-span-6 xl:col-span-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">{t('home.cardHistoryTitle')}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {recent.length > 0 ? t('home.recentSummary', { count: recent.length }) : t('home.cleanLatestEmpty')}
          </p>
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-iqon-row hover:text-foreground"
          aria-label={t('home.action.history')}
        >
          <History className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-2">
        {recent.length === 0 ? (
          <div className="flex h-full min-h-24 items-center justify-center rounded-xl border border-dashed border-iqon-border text-[11px] text-muted-foreground">
            {t('home.cleanLatestEmpty')}
          </div>
        ) : (
          recent.map((record) => {
            const recordType = record.type ?? 'organize'
            const Icon = recordType === 'clean' ? Trash2
              : recordType === 'organize' ? Sparkles
              : recordType === 'optimize' ? Zap
              : recordType === 'uninstall' ? PackageSearch
              : recordType === 'installer' ? Archive
              : recordType === 'purge' ? PackageX
              : recordType === 'duplicates' ? Copy
              : Activity
            const isExecuted = record.executed
            const dotClass = record.undone ? 'iqon-dot-muted' : isExecuted ? 'iqon-dot-green' : 'iqon-dot-yellow'
            return (
              <div key={record.id} className="flex items-center gap-3 rounded-xl border border-iqon-border bg-iqon-row p-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-iqon-border bg-iqon-card">
                  <Icon className="h-3.5 w-3.5 text-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{record.directory}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {new Date(record.timestamp).toLocaleString()}
                  </p>
                </div>
                <span className={cn('iqon-dot', dotClass)} />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
