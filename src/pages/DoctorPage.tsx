import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { cn, formatDate } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { save } from '@tauri-apps/api/dialog'
import { writeTextFile } from '@tauri-apps/api/fs'
import { open } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import { buildDiagnostics, findPrimaryDisk, sortProcesses } from './status/diagnostics'
import type { MoleDoctorCheck, MoleDoctorLevel, MoleDoctorResult } from './mole/doctorTypes'
import { buildDoctorIssueUrl, buildDoctorReport } from './mole/doctorReport'
import { collectRecentFailureSignals, summarizeDoctorSections, type DoctorSectionSummary } from './mole/doctorSections'

type Tone = 'green' | 'yellow' | 'red'

const LEVEL_TONE: Record<MoleDoctorLevel, Tone> = {
  success: 'green',
  warning: 'yellow',
  destructive: 'red',
}

const TONE: Record<Tone, { text: string; glow: string; mesh: string; dot: string; chipBorder: string }> = {
  green: { text: 'text-iqon-green', glow: 'bg-iqon-green', mesh: 'text-iqon-green/40', dot: 'iqon-dot-green', chipBorder: 'border-iqon-green/40 text-iqon-green' },
  yellow: { text: 'text-iqon-yellow', glow: 'bg-iqon-yellow', mesh: 'text-iqon-yellow/40', dot: 'iqon-dot-yellow', chipBorder: 'border-iqon-yellow/40 text-iqon-yellow' },
  red: { text: 'text-iqon-red', glow: 'bg-iqon-red', mesh: 'text-iqon-red/40', dot: 'iqon-dot-red', chipBorder: 'border-iqon-red/40 text-iqon-red' },
}

function mapCheckIcon(level: MoleDoctorLevel) {
  if (level === 'destructive') return AlertTriangle
  if (level === 'warning') return AlertCircle
  return CheckCircle2
}

export function DoctorPage() {
  const { t } = useI18n()
  const historyRecords = useAppStore((s) => s.history)
  const [data, setData] = useState<MoleDoctorResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failuresOpen, setFailuresOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  const refresh = async () => {
    setLoading(true)
    try {
      const next = await invoke<MoleDoctorResult>('mole_doctor_json')
      setData(next)
      await saveResultSnapshot(resultCacheKeys.doctor, next)
      setError(null)
    } catch (err) {
      const message = String(err)
      setError(message)
      toast.error(t('doctor.fail', { error: message }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      const snapshot = await loadResultSnapshot<MoleDoctorResult>(resultCacheKeys.doctor)
      if (snapshot) setData(snapshot.payload)
      await refresh()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const status = data?.status ?? null
  const primaryDisk = useMemo(() => findPrimaryDisk(status?.disks), [status])
  const sortedProcesses = useMemo(() => sortProcesses(status?.top_processes), [status])
  const diagnostics = useMemo(
    () => (status ? buildDiagnostics(status, primaryDisk, sortedProcesses[0], t) : []),
    [status, primaryDisk, sortedProcesses, t]
  )
  const rawChecks = data?.checks ?? []
  const sections = useMemo(() => summarizeDoctorSections(rawChecks, t), [rawChecks, t])
  const translatedChecks = useMemo(() => sections.flatMap((section) => section.checks), [sections])
  const translatedData = useMemo(() => (data ? { ...data, checks: translatedChecks } : null), [data, translatedChecks])
  const recentFailures = useMemo(() => collectRecentFailureSignals(historyRecords), [historyRecords])
  const report = useMemo(() => (translatedData ? buildDoctorReport(translatedData, diagnostics, t) : ''), [translatedData, diagnostics, t])

  const issueCount = translatedChecks.filter((item) => item.level !== 'success').length
  const actionCount = translatedChecks.filter((item) => Boolean(item.action)).length
  const score = data?.health_score ?? 0
  const heroTone: Tone = issueCount === 0 ? 'green' : score >= 60 ? 'yellow' : 'red'
  const heroT = TONE[heroTone]

  const issueSections = sections.filter((s) => s.level !== 'success')
  const healthySections = sections.filter((s) => s.level === 'success')

  const copyReport = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report)
      toast.success(t('doctor.report.copySuccess'))
    } catch (err) {
      toast.error(t('doctor.report.copyFail', { error: String(err) }))
    }
  }

  const exportReport = async () => {
    if (!report) return
    try {
      const path = await save({
        defaultPath: `stowmind-doctor-${new Date().toISOString().slice(0, 10)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        title: t('doctor.report.exportDialogTitle'),
      })
      if (path == null || typeof path !== 'string') return
      await writeTextFile(path, report)
      toast.success(t('doctor.report.exportSuccess'))
    } catch (err) {
      toast.error(t('doctor.report.exportFail', { error: String(err) }))
    }
  }

  const openIssue = async () => {
    if (!report) return
    try {
      await open(buildDoctorIssueUrl(report))
    } catch (err) {
      toast.error(t('doctor.report.issueFail', { error: String(err) }))
    }
  }

  const toggleSection = (id: string) => {
    setExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.system')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('doctor.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {data ? t('doctor.collectedAt', { value: formatDate(data.collected_at) }) : t('doctor.loading')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('doctor.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyReport()} disabled={!data}>
            <ClipboardCopy className="mr-2 h-4 w-4" />
            {t('doctor.copyReport')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportReport()} disabled={!data}>
            <Download className="mr-2 h-4 w-4" />
            {t('doctor.exportReport')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openIssue()} disabled={!data}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('doctor.openIssue')}
          </Button>
        </div>
      </div>

      {error && !data && (
        <div className="iqon-card border-iqon-yellow/30 bg-iqon-yellow/10 p-4">
          <div className="flex items-center gap-2 font-bold text-iqon-yellow">
            <AlertTriangle className="h-5 w-5" />
            {t('doctor.errorTitle')}
          </div>
          <p className="mt-2 break-words text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      <div className="iqon-card relative overflow-hidden p-6 md:p-8">
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className={cn('absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full opacity-[0.18] blur-[60px]', heroT.glow)} />
          <div className={cn('iqon-mesh absolute inset-0', heroT.mesh)} />
        </div>
        <div className="relative z-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] md:items-center">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('iqon-pill', heroT.chipBorder)}>
                <span className={cn('iqon-dot', heroT.dot)} />
                {issueCount === 0 ? t('doctor.summary.allClear') : t('doctor.summary.issues', { n: issueCount })}
              </span>
              {actionCount > 0 && (
                <span className="iqon-pill border-iqon-cyan/40 text-iqon-cyan">
                  <Wrench className="h-3 w-3" />
                  {t('doctor.summary.actions', { n: actionCount })}
                </span>
              )}
              {data?.update_available && (
                <span className="iqon-pill border-iqon-yellow/40 text-iqon-yellow">
                  <Download className="h-3 w-3" />
                  {t('doctor.metric.updateAvailable')}
                </span>
              )}
            </div>
            <div>
              <p className="iqon-eyebrow">{t('doctor.summary.scoreLabel')}</p>
              <p className="mt-1 flex items-end gap-2">
                <span className="text-5xl font-bold tabular-nums">{data ? score : '—'}</span>
                <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
              </p>
              <p className="mt-2 max-w-xl text-xs text-muted-foreground">{data?.health_score_msg ?? t('doctor.loading')}</p>
            </div>
          </div>
          <div className="iqon-row p-5">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className={cn('h-5 w-5', heroT.text)} />
              <p className="text-sm font-bold">{t('doctor.metric.health')}</p>
            </div>
            <Progress value={Math.max(0, Math.min(100, score))} className="h-2" />
            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground">{translatedChecks.length}</p>
                <p className="iqon-eyebrow mt-1">{t('doctor.insight.total', { n: '' }).replace('{n}', '').trim() || 'TOTAL'}</p>
              </div>
              <div>
                <p className={cn('text-2xl font-bold tabular-nums', issueCount > 0 ? heroT.text : 'text-muted-foreground')}>{issueCount}</p>
                <p className="iqon-eyebrow mt-1">{t('doctor.metric.security')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="iqon-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">{t('doctor.sectionsTitle')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('doctor.sectionsDesc')}</p>
          </div>
        </div>

        {issueSections.length === 0 && healthySections.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('doctor.section.empty')}</p>
        ) : issueSections.length === 0 ? (
          <div className="iqon-row flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-iqon-green" />
            <p className="text-sm font-bold text-iqon-green">{t('doctor.section.allHealthy')}</p>
            <span className="ml-auto text-xs text-muted-foreground">
              {healthySections.length} · {translatedChecks.length}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {issueSections.map((section) => (
              <SectionRow
                key={section.id}
                section={section}
                expanded={expandedSections.has(section.id)}
                onToggle={() => toggleSection(section.id)}
                t={t}
              />
            ))}
            {healthySections.length > 0 && (
              <div className="iqon-row mt-3 flex items-center gap-3 p-3 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-iqon-green" />
                <span>{t('doctor.section.allHealthy')}</span>
                <span className="ml-auto font-mono">
                  {healthySections.length} / {sections.length}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {recentFailures.length > 0 && (
        <div className="iqon-card overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-iqon-row"
            onClick={() => setFailuresOpen((value) => !value)}
          >
            <div>
              <div className="flex items-center gap-2 text-sm font-bold">
                <AlertCircle className="h-4 w-4 text-iqon-yellow" />
                {t('doctor.failuresTitle')}
                <span className="iqon-pill border-iqon-yellow/40 text-iqon-yellow">{recentFailures.length}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('doctor.failuresDesc')}</p>
            </div>
            {failuresOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {failuresOpen && (
            <div className="space-y-2 border-t border-iqon-border p-5">
              {recentFailures.map((failure) => (
                <div key={failure.id} className="iqon-row p-4">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <p className="break-words text-sm font-bold">{failure.title}</p>
                    <span className="font-mono text-[10px] text-muted-foreground">{formatDate(failure.timestamp)}</span>
                  </div>
                  <p className="mt-2 break-words text-xs text-muted-foreground">{failure.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectionRow({
  section,
  expanded,
  onToggle,
  t,
}: {
  section: DoctorSectionSummary
  expanded: boolean
  onToggle: () => void
  t: ReturnType<typeof useI18n>['t']
}) {
  const tone = TONE[LEVEL_TONE[section.level]]
  const visibleChecks = expanded ? section.checks : section.checks.filter((c) => c.level !== 'success')
  const hiddenHealthy = section.checks.length - visibleChecks.length

  return (
    <div className="iqon-row overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-iqon-card"
      >
        <span className={cn('iqon-dot', tone.dot)} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-bold">{section.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('doctor.section.summary', {
              total: section.checks.length,
              issues: section.issueCount,
              actions: section.actionCount,
            })}
          </p>
        </div>
        {hiddenHealthy > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {expanded ? t('doctor.section.collapse') : t('doctor.section.expand', { n: hiddenHealthy })}
          </span>
        )}
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      <div className="space-y-2 border-t border-iqon-border bg-iqon-card/40 p-3">
        {visibleChecks.map((check) => (
          <CheckRow key={`${check.title}-${check.detail}`} check={check} t={t} />
        ))}
      </div>
    </div>
  )
}

function CheckRow({ check, t }: { check: MoleDoctorCheck; t: ReturnType<typeof useI18n>['t'] }) {
  const Icon = mapCheckIcon(check.level)
  const tone = TONE[LEVEL_TONE[check.level]]
  return (
    <div className="rounded-xl border border-iqon-border bg-background/40 p-3">
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone.text)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('iqon-pill text-[10px]', tone.chipBorder)}>
              {t(`status.level.${check.level}` as Parameters<typeof t>[0])}
            </span>
            <p className="break-words text-sm font-bold">{check.title}</p>
          </div>
          {check.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{check.detail}</p>}
          {check.action && (
            <div className="mt-2 inline-flex max-w-full rounded-lg border border-iqon-border bg-iqon-row px-2.5 py-1 text-[11px]">
              <span className="truncate font-mono text-foreground/80">{check.action}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
