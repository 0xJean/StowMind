import { useI18n } from '@/i18n'
import { cn, formatFileSize } from '@/lib/utils'
import { Clock3, Eye, FileText, RotateCcw, ShieldCheck } from 'lucide-react'
import type { PendingCleanScanSnapshot } from './cleanScanSnapshot'
import type { MoleCleanItem, MoleCleanSection } from './types'

type Tone = 'green' | 'cyan' | 'yellow' | 'red' | 'purple'

const TONE_BAR: Record<Tone, string> = {
  green: 'bg-iqon-green',
  cyan: 'bg-iqon-cyan',
  yellow: 'bg-iqon-yellow',
  red: 'bg-iqon-red',
  purple: 'bg-iqon-purple',
}

const SECTION_TONES: Tone[] = ['green', 'cyan', 'yellow', 'red', 'purple']

interface PendingCleanScanCardProps {
  snapshot: PendingCleanScanSnapshot
  onView: () => void
  onRescan: () => void
}

export function PendingCleanScanCard({ snapshot, onView, onRescan }: PendingCleanScanCardProps) {
  const { locale, t } = useI18n()
  const scannedAt = formatScanTime(snapshot.createdAt, locale)
  const topSections = summarizeSections(snapshot.preview.sections)

  return (
    <div className="iqon-card relative w-full max-w-6xl overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -right-20 top-0 h-72 w-72 rounded-full bg-iqon-green opacity-[0.14] blur-[60px]" />
        <div className="iqon-mesh-soft absolute inset-0 text-iqon-green/40" />
      </div>

      <div className="relative z-10 flex flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-iqon-green/30 bg-iqon-green/10 text-iqon-green">
              <Clock3 className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="iqon-pill border-iqon-green/40 text-iqon-green">
                  <span className="iqon-dot iqon-dot-green" />
                  {t('clean.pendingBadge')}
                </span>
                <span className="iqon-pill">
                  {t('clean.pendingSafePreview')}
                </span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{t('clean.pendingTitle')}</h2>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                {t('clean.pendingDesc')}
              </p>
            </div>
          </div>

          <div className="iqon-row flex shrink-0 items-center gap-2 px-4 py-3">
            <ShieldCheck className="h-4 w-4 text-iqon-green" />
            <div className="text-left">
              <p className="iqon-eyebrow">{t('clean.pendingSnapshot')}</p>
              <p className="mt-0.5 text-xs font-bold tabular-nums">{scannedAt}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Left: hero summary */}
          <div className="iqon-row relative flex min-h-[18rem] flex-col justify-between overflow-hidden p-5">
            <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-iqon-green opacity-[0.18] blur-[50px]" />
            <div className="relative z-10">
              <p className="iqon-eyebrow">{t('clean.potentialSpace')}</p>
              <p className="mt-2 text-5xl font-bold leading-none tabular-nums md:text-6xl">
                {formatFileSize(snapshot.preview.potential_space)}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <PendingStat label={t('clean.itemCount')} value={snapshot.preview.item_count} />
                <PendingStat label={t('clean.categoryCount')} value={snapshot.preview.category_count} />
              </div>
            </div>

            <div className="relative z-10 mt-6 flex flex-col gap-2 sm:flex-row">
              <button type="button" className="iqon-btn-primary flex-1 justify-center" onClick={onView}>
                <Eye className="h-4 w-4" />
                {t('clean.pendingViewResult')}
              </button>
              <button type="button" className="iqon-btn-secondary flex-1 justify-center" onClick={onRescan}>
                <RotateCcw className="h-4 w-4" />
                {t('clean.pendingRescan')}
              </button>
            </div>
          </div>

          {/* Right: top sections */}
          <div className="iqon-card p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">{t('clean.pendingCategories')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('clean.pendingCategoryDesc')}
                </p>
              </div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-iqon-border bg-iqon-row text-muted-foreground">
                <FileText className="h-4 w-4" />
              </span>
            </div>

            <div className="space-y-2">
              {topSections.length > 0 ? topSections.map((section, index) => (
                <PendingSectionRow key={section.title} section={section} tone={SECTION_TONES[index % SECTION_TONES.length]} />
              )) : (
                <div className="iqon-row p-4 text-xs text-muted-foreground">
                  {t('clean.cleanableSectionEmpty')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PendingStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-iqon-border bg-iqon-card px-3 py-2.5 text-left">
      <p className="iqon-eyebrow">{label}</p>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function PendingSectionRow({ section, tone }: { section: SectionSummary; tone: Tone }) {
  const { t } = useI18n()

  return (
    <div className="iqon-row p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{section.title}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {t('clean.cleanableSectionCount', {
              selected: section.count || section.items,
              total: section.count || section.items,
            })}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
          {section.size > 0 ? formatFileSize(section.size) : t('clean.cleanableNoSize')}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-iqon-border">
        <div
          className={cn('h-full rounded-full transition-all duration-500', TONE_BAR[tone])}
          style={{ width: `${section.percent}%` }}
        />
      </div>
    </div>
  )
}

interface SectionSummary {
  title: string
  size: number
  count: number
  items: number
  percent: number
}

function summarizeSections(sections: MoleCleanSection[]): SectionSummary[] {
  const rows = sections.map((section) => {
    const size = section.items.reduce((sum, item) => sum + itemSize(item), 0)
    const count = section.items.reduce((sum, item) => sum + (item.count ?? 0), 0)
    return {
      title: section.title,
      size,
      count,
      items: section.items.length,
      percent: 0,
    }
  }).sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size
    return b.items - a.items
  }).slice(0, 5)

  const maxValue = Math.max(...rows.map((row) => row.size || row.count || row.items), 1)
  return rows.map((row) => ({
    ...row,
    percent: Math.max(8, Math.round(((row.size || row.count || row.items) / maxValue) * 100)),
  }))
}

function itemSize(item: MoleCleanItem) {
  return typeof item.size === 'number' && item.size > 0 ? item.size : 0
}

function formatScanTime(value: string, locale: 'zh' | 'en') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
