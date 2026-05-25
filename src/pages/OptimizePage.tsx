import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { cn, formatDecimal } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'

interface MoleOptimizationItem {
  category: string
  name: string
  description: string
  action: string
  safe: boolean
}

interface MoleOptimizeHealth {
  health_score: number
  health_score_msg: string
  memory_used_gb: number
  memory_total_gb: number
  disk_used_gb: number
  disk_total_gb: number
  disk_used_percent: number
  uptime_days: number
  active_whitelist: string[]
  optimizations: MoleOptimizationItem[]
  raw_output: string
  platform: string
}

interface MoleOptimizeExecuteOutcome {
  applied_count: number
  raw_output: string
}

type SortMode = 'category' | 'name' | 'action'

type Tone = 'green' | 'cyan' | 'yellow' | 'red'

const TONE: Record<Tone, { text: string; glow: string; mesh: string; dot: string }> = {
  green: { text: 'text-iqon-green', glow: 'bg-iqon-green', mesh: 'text-iqon-green/40', dot: 'iqon-dot-green' },
  cyan: { text: 'text-iqon-cyan', glow: 'bg-iqon-cyan', mesh: 'text-iqon-cyan/40', dot: 'iqon-dot-cyan' },
  yellow: { text: 'text-iqon-yellow', glow: 'bg-iqon-yellow', mesh: 'text-iqon-yellow/40', dot: 'iqon-dot-yellow' },
  red: { text: 'text-iqon-red', glow: 'bg-iqon-red', mesh: 'text-iqon-red/40', dot: 'iqon-dot-red' },
}

export function OptimizePage() {
  const { t } = useI18n()
  const [data, setData] = useState<MoleOptimizeHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [query, setQuery] = useState('')
  const [safeOnly, setSafeOnly] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('category')
  const [rawOpen, setRawOpen] = useState(false)
  const [lastRunOutput, setLastRunOutput] = useState<string | null>(null)
  const addHistory = useAppStore((s) => s.addHistory)
  const statistics = useAppStore((s) => s.statistics)
  const updateStatistics = useAppStore((s) => s.updateStatistics)

  const refresh = async () => {
    setLoading(true)
    try {
      const next = await invoke<MoleOptimizeHealth>('mole_optimize_health_json')
      setData(next)
      await saveResultSnapshot(resultCacheKeys.optimizeHealth, next)
      return next
    } catch (err) {
      toast.error(t('optimize.fail', { error: String(err) }))
      return null
    } finally {
      setLoading(false)
    }
  }

  const runOptimize = async () => {
    if (!data) {
      toast.info(t('optimize.recordNeedRefresh'))
      return
    }

    const confirmed = window.confirm(
      t('optimize.executeConfirm', {
        count: data.optimizations.length,
        safe: safeCount,
      })
    )
    if (!confirmed) return

    setExecuting(true)
    try {
      const outcome = await invoke<MoleOptimizeExecuteOutcome>('mole_optimize_execute')
      const timestamp = new Date().toISOString()
      const itemCount = outcome.applied_count || data.optimizations.length

      setLastRunOutput(outcome.raw_output)
      addHistory(createCleanupHistoryRecord({
        type: 'optimize',
        target: t('optimize.title'),
        label: t('history.type.optimize'),
        itemCount,
        totalSize: 0,
        action: 'execute',
        executed: true,
        timestamp,
      }))
      updateStatistics({
        cleanOperationCount: (statistics.cleanOperationCount ?? 0) + 1,
        lastCleaned: timestamp,
      })
      toast.success(t('optimize.executeSuccess', { count: itemCount }))
      await refresh()
    } catch (err) {
      toast.error(t('optimize.executeFail', { error: String(err) }))
    } finally {
      setExecuting(false)
    }
  }

  const filteredItems = useMemo(() => {
    const items = [...(data?.optimizations ?? [])]
    const needle = query.trim().toLowerCase()

    return items
      .filter((item) => {
        if (safeOnly && !item.safe) return false
        if (!needle) return true
        return [item.category, item.name, item.description, item.action]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((a, b) => {
        if (sortMode === 'name') return a.name.localeCompare(b.name)
        if (sortMode === 'action') return a.action.localeCompare(b.action)
        return a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
      })
  }, [data, query, safeOnly, sortMode])

  const safeCount = data?.optimizations.filter((item) => item.safe).length ?? 0
  const reviewCount = Math.max((data?.optimizations.length ?? 0) - safeCount, 0)
  const healthScore = Math.max(0, Math.min(100, data?.health_score ?? 0))
  const actionCount = data?.optimizations.length ?? 0
  const canExecute = Boolean(data && actionCount > 0 && !loading && !executing)
  const heroTone: Tone = healthScore >= 80 ? 'green' : healthScore >= 60 ? 'cyan' : healthScore >= 40 ? 'yellow' : 'red'
  const heroT = TONE[heroTone]

  useEffect(() => {
    void (async () => {
      const snapshot = await loadResultSnapshot<MoleOptimizeHealth>(resultCacheKeys.optimizeHealth)
      if (snapshot) setData(snapshot.payload)
      await refresh()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="stow-page-wide">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
        <section className="iqon-card relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 z-0">
            <div className={cn('absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full opacity-[0.18] blur-[60px]', heroT.glow)} />
            <div className={cn('iqon-mesh absolute inset-0', heroT.mesh)} />
          </div>
          <div className="relative z-10 grid min-h-[23rem] gap-6 p-6 md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-stretch">
            <div className="flex min-w-0 flex-col justify-center space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="iqon-pill">
                  <Zap className="h-3 w-3" />
                  {t('optimize.metric.mode')}
                </span>
                <span className={cn('iqon-pill', reviewCount > 0 ? 'border-iqon-yellow/40 text-iqon-yellow' : 'border-iqon-green/40 text-iqon-green')}>
                  <span className={cn('iqon-dot', reviewCount > 0 ? 'iqon-dot-yellow' : 'iqon-dot-green')} />
                  {reviewCount > 0
                    ? t('optimize.heroReview', { count: reviewCount })
                    : t('optimize.heroReady')}
                </span>
              </div>
              <div className="max-w-2xl space-y-3">
                <p className="iqon-eyebrow">{t('eyebrow.optimize')}</p>
                <h1 className="text-3xl font-bold tracking-tight">{t('optimize.title')}</h1>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">{t('optimize.subtitle')}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="iqon-btn-primary" onClick={() => void refresh()} disabled={loading || executing}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {loading ? t('optimize.scanning') : t('optimize.scan')}
                </button>
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-colors',
                    canExecute
                      ? 'border border-iqon-red/40 bg-iqon-red/10 text-iqon-red hover:bg-iqon-red/20'
                      : 'border border-iqon-border bg-iqon-row text-muted-foreground opacity-60'
                  )}
                  onClick={() => void runOptimize()}
                  disabled={!canExecute}
                >
                  {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {executing ? t('optimize.executing') : t('optimize.execute')}
                </button>
              </div>
            </div>
            <div className="iqon-row flex min-w-0 items-center p-5">
              <div className="w-full space-y-5">
                <div>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="iqon-eyebrow">{t('optimize.healthLabel')}</p>
                      <p className="mt-1 text-4xl font-bold tabular-nums">{healthScore}</p>
                    </div>
                    <div className="relative h-12 w-12">
                      <div className={cn('absolute inset-0 rounded-full opacity-20 blur-md', heroT.glow)} />
                      <Gauge className={cn('relative h-12 w-12', heroT.text)} />
                    </div>
                  </div>
                  <Progress value={healthScore} className="mt-4 h-3" />
                  <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">{data?.health_score_msg ?? t('optimize.loading')}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <HeroStat label={t('optimize.metric.optimizations')} value={String(actionCount)} />
                  <HeroStat label={t('optimize.metric.safeCount')} value={String(safeCount)} tone="green" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="iqon-card p-5">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-iqon-green" />
              <h3 className="text-sm font-bold text-foreground">{t('optimize.nextTitle')}</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('optimize.nextDesc')}</p>
          </div>
          <div className="space-y-2">
            <StepRow active={!data || loading} done={Boolean(data)} label={t('optimize.step.scan')} detail={t('optimize.step.scanDesc')} />
            <StepRow active={Boolean(data && !executing)} done={Boolean(data && actionCount > 0)} label={t('optimize.step.review')} detail={t('optimize.step.reviewDesc', { count: actionCount })} />
            <StepRow active={executing} done={Boolean(lastRunOutput)} label={t('optimize.step.execute')} detail={lastRunOutput ? t('optimize.step.done') : t('optimize.step.executeDesc')} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard tone="cyan" icon={Activity} title={t('optimize.metric.memory')} value={`${formatDecimal(data?.memory_used_gb ?? 0)} / ${formatDecimal(data?.memory_total_gb ?? 0)} GB`} detail={t('optimize.metric.memoryValue', { used: formatDecimal(data?.memory_used_gb ?? 0), total: formatDecimal(data?.memory_total_gb ?? 0) })} />
        <MetricCard tone="yellow" icon={Gauge} title={t('optimize.metric.disk')} value={`${formatDecimal(data?.disk_used_percent ?? 0)}%`} detail={t('optimize.metric.diskValue', { used: formatDecimal(data?.disk_used_gb ?? 0), total: formatDecimal(data?.disk_total_gb ?? 0), percent: formatDecimal(data?.disk_used_percent ?? 0) })} />
        <MetricCard tone="green" icon={ShieldCheck} title={t('optimize.metric.uptime')} value={t('optimize.metric.uptimeValue', { days: formatDecimal(data?.uptime_days ?? 0, 0) })} detail={data?.platform ?? '—'} />
        <MetricCard tone={reviewCount > 0 ? 'red' : 'green'} icon={AlertTriangle} title={t('optimize.metric.reviewRequired')} value={String(reviewCount)} detail={t('optimize.metric.optimizationValue', { safe: safeCount, total: actionCount })} />
      </div>

      <div className="iqon-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">{t('optimize.listTitle')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('optimize.listDesc')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || executing}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              {t('optimize.refresh')}
            </Button>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors',
                canExecute
                  ? 'border border-iqon-red/40 bg-iqon-red/10 text-iqon-red hover:bg-iqon-red/20'
                  : 'border border-iqon-border bg-iqon-row text-muted-foreground opacity-60'
              )}
              onClick={() => void runOptimize()}
              disabled={!canExecute}
            >
              {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {t('optimize.execute')}
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('optimize.searchPlaceholder')} className="pl-9" />
            </div>
            <div className="iqon-row flex items-center gap-3 px-3 py-2">
              <Switch checked={safeOnly} onCheckedChange={setSafeOnly} />
              <span className="text-xs font-bold">{safeOnly ? t('optimize.safeOnly') : t('optimize.showAll')}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex">
              {(['category', 'name', 'action'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSortMode(mode)}
                  className={cn(
                    'inline-flex items-center justify-center rounded-xl border px-4 py-2 text-xs font-bold transition-colors',
                    sortMode === mode
                      ? 'border-iqon-green bg-iqon-green/10 text-iqon-green'
                      : 'border-iqon-border bg-iqon-card text-muted-foreground hover:border-iqon-borderSoft hover:text-foreground'
                  )}
                >
                  {t(`optimize.${mode === 'category' ? 'category' : mode === 'name' ? 'sortName' : 'action'}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </div>

          {filteredItems.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {filteredItems.map((item) => (
                <OptimizationCard key={`${item.category}-${item.name}-${item.action}`} item={item} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-iqon-border bg-iqon-row p-8 text-center text-xs text-muted-foreground">
              {t('optimize.noResults')}
            </div>
          )}
        </div>
      </div>

      <div className="iqon-card overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-iqon-row"
          onClick={() => setRawOpen((value) => !value)}
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <ChevronRight className={cn('h-4 w-4 transition-transform', rawOpen && 'rotate-90')} />
            {t('optimize.rawTitle')}
          </span>
          {rawOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {rawOpen && (
          <div className="space-y-3 border-t border-iqon-border px-5 pb-5 pt-4">
            <div className="flex flex-wrap gap-2">
              {data?.active_whitelist?.map((item) => (
                <Badge key={item} variant="outline" className="font-mono">{item}</Badge>
              ))}
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl border border-iqon-border bg-iqon-row p-4 text-xs leading-relaxed text-muted-foreground">
              {lastRunOutput ?? data?.raw_output ?? ''}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-iqon-border bg-iqon-card p-3">
      <p className="iqon-eyebrow">{label}</p>
      <p className={cn('mt-1 text-xl font-bold tabular-nums', tone ? TONE[tone].text : '')}>{value}</p>
    </div>
  )
}

function MetricCard({ tone, icon: Icon, title, value, detail }: { tone: Tone; icon: LucideIcon; title: string; value: string; detail: string }) {
  const t = TONE[tone]
  return (
    <div className="iqon-card iqon-card-hover relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className={cn('absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-[0.18] blur-[40px]', t.glow)} />
        <div className={cn('iqon-mesh-soft absolute inset-0', t.mesh)} />
      </div>
      <div className="relative z-10 flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-iqon-border bg-iqon-row">
          <Icon className={cn('h-5 w-5', t.text)} />
        </span>
        <div className="min-w-0">
          <p className="iqon-eyebrow">{title}</p>
          <p className="mt-1 break-words text-xl font-bold tabular-nums">{value}</p>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function StepRow({ active, done, label, detail }: { active: boolean; done: boolean; label: string; detail: string }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-xl border p-3 transition-colors',
        done
          ? 'border-iqon-green/30 bg-iqon-green/5'
          : active
            ? 'border-iqon-cyan/30 bg-iqon-cyan/5'
            : 'border-iqon-border bg-iqon-row'
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          done
            ? 'bg-iqon-green/15 text-iqon-green'
            : active
              ? 'bg-iqon-cyan/15 text-iqon-cyan'
              : 'bg-iqon-border text-muted-foreground'
        )}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-foreground">{label}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function OptimizationCard({ item }: { item: MoleOptimizationItem }) {
  const { t } = useI18n()
  const safe = item.safe
  return (
    <div className="iqon-card iqon-card-hover relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className={cn('absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.12] blur-[40px]', safe ? 'bg-iqon-green' : 'bg-iqon-yellow')} />
      </div>
      <div className="relative z-10 flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border',
            safe
              ? 'border-iqon-green/30 bg-iqon-green/10 text-iqon-green'
              : 'border-iqon-yellow/30 bg-iqon-yellow/10 text-iqon-yellow'
          )}
        >
          {safe ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">{item.name}</h2>
            <span className="iqon-pill">{item.category}</span>
            <span
              className={cn(
                'iqon-pill',
                safe
                  ? 'border-iqon-green/40 text-iqon-green'
                  : 'border-iqon-yellow/40 text-iqon-yellow'
              )}
            >
              <span className={cn('iqon-dot', safe ? 'iqon-dot-green' : 'iqon-dot-yellow')} />
              {safe ? t('optimize.safeBadge') : t('optimize.metric.reviewRequired')}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
            {item.description || t('optimize.emptyDescription')}
          </p>
          <div className="mt-3 inline-flex max-w-full rounded-lg border border-iqon-border bg-iqon-row px-2.5 py-1 text-[11px] font-semibold">
            <span className="truncate font-mono text-foreground/80">{item.action}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
