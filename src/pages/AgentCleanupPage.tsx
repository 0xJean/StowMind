import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { formatFileSize } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { invoke } from '@tauri-apps/api/tauri'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderSearch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import { SystemCacheCard } from './system-cache/SystemCacheCard'
import { useSystemCache } from './system-cache/useSystemCache'
import {
  type AgentCleanupCategory,
  type AgentCleanupExecuteResult,
  type AgentCleanupItem,
  type AgentCleanupScanResult,
} from './agent-cleanup/types'

const DEFAULT_RETENTION_DAYS = 30

function categoryLabel(category: AgentCleanupCategory, t: (key: any, vars?: any) => string) {
  return t(`agentCleanup.category.${category}`)
}

function formatModifiedAt(value: string | number | null | undefined) {
  if (!value) return '—'
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function AgentCleanupPage() {
  const { t } = useI18n()
  const active = useLocation().pathname === '/agent-cleanup'
  const systemCache = useSystemCache(active)
  const addHistory = useAppStore((state) => state.addHistory)
  const updateStatistics = useAppStore((state) => state.updateStatistics)
  const statistics = useAppStore((state) => state.statistics)
  const [retentionInput, setRetentionInput] = useState(String(DEFAULT_RETENTION_DAYS))
  const [data, setData] = useState<AgentCleanupScanResult | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<AgentCleanupExecuteResult | null>(null)
  const [gitPruneExecuted, setGitPruneExecuted] = useState(false)
  const scanningRef = useRef(false)

  const retentionDays = Math.max(0, Number.parseInt(retentionInput, 10) || 0)
  const selectableItems = useMemo(
    () => (data?.items ?? []).filter((item) => !item.protected),
    [data]
  )
  const bulkSelectableItems = useMemo(
    () => selectableItems.filter((item) => item.category !== 'git_unreachable_object'),
    [selectableItems]
  )
  const selectedItems = useMemo(
    () => selectableItems.filter((item) => selectedIds.has(item.id)),
    [selectableItems, selectedIds]
  )
  const selectedBytes = useMemo(
    () => selectedItems.reduce((total, item) => total + Math.max(0, item.size), 0),
    [selectedItems]
  )
  const groupedItems = useMemo(() => {
    const groups = new Map<string, AgentCleanupItem[]>()
    for (const item of data?.items ?? []) {
      const key = `${item.agent}:${item.category}`
      const current = groups.get(key) ?? []
      current.push(item)
      groups.set(key, current)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [data])

  const applyDefaults = (next: AgentCleanupScanResult) => {
    setSelectedIds(new Set(next.items.filter((item) => item.default_selected && !item.protected).map((item) => item.id)))
    setExpanded(new Set())
  }

  const scanAgent = async (preserveResult = false) => {
    if (scanningRef.current) return
    scanningRef.current = true
    setLoading(true)
    setError(null)
    if (!preserveResult) setResult(null)
    try {
      const next = await invoke<AgentCleanupScanResult>('agent_cleanup_scan', { retentionDays })
      setData(next)
      setRetentionInput(String(next.retention_days ?? retentionDays))
      applyDefaults(next)
      if (next.items.length === 0) toast.success(t('agentCleanup.noneFound'))
    } catch (cause) {
      const message = String(cause)
      setError(message)
      toast.error(t('agentCleanup.scanFailed', { error: message }))
    } finally {
      scanningRef.current = false
      setLoading(false)
    }
  }

  const scan = (preserveResult = false) => {
    // The shared system probe has its own result and authorization flow. It
    // must not delay Agent results or enter their selections and statistics.
    void systemCache.scan()
    return scanAgent(preserveResult)
  }

  useEffect(() => {
    void scanAgent()
    // Scan once on entry. Changes to the retention rule require an explicit rescan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (active) void systemCache.scan()
    // Invalidate old cache authorization when returning to this keep-alive page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const toggleItem = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (items: AgentCleanupItem[]) => {
    const ids = items
      .filter((item) => !item.protected && item.category !== 'git_unreachable_object')
      .map((item) => item.id)
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id))
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    const allSelected = bulkSelectableItems.length > 0 && bulkSelectableItems.every((item) => selectedIds.has(item.id))
    setSelectedIds(allSelected ? new Set() : new Set(bulkSelectableItems.map((item) => item.id)))
  }

  const execute = async () => {
    if (selectedItems.length === 0) return
    const confirmed = window.confirm(t('agentCleanup.confirm', {
      count: selectedItems.length,
      size: formatFileSize(selectedBytes),
    }))
    if (!confirmed) return
    const includesGitPrune = selectedItems.some((item) => item.category === 'git_unreachable_object')
    if (includesGitPrune && !window.confirm(t('agentCleanup.gitPruneConfirm'))) return

    setExecuting(true)
    setError(null)
    try {
      const next = await invoke<AgentCleanupExecuteResult>('agent_cleanup_execute', {
        request: {
          itemIds: selectedItems.map((item) => item.id),
          retentionDays,
          confirmed: true,
        },
      })
      const timestamp = next.completed_at
        ? new Date(Number(next.completed_at) * 1000 || next.completed_at).toISOString()
        : new Date().toISOString()
      const categoryCounts = selectedItems.reduce<Record<string, number>>((counts, item) => {
        const action = next.actions?.find((candidate) => candidate.path === item.path)
        if (action?.success) {
          const label = categoryLabel(item.category, t)
          counts[label] = (counts[label] ?? 0) + 1
        }
        return counts
      }, {})
      const hasGitPrune = includesGitPrune
      const cleanupErrors = next.errors ?? []
      addHistory(createCleanupHistoryRecord({
        type: 'agent-cleanup',
        target: t('agentCleanup.title'),
        label: t('history.type.agent-cleanup'),
        itemCount: next.removed_count,
        totalSize: next.freed_bytes,
        action: 'execute',
        executed: true,
        errors: cleanupErrors,
        skippedCount: next.skipped_count ?? cleanupErrors.length,
        riskNotes: hasGitPrune ? [t('agentCleanup.gitPruneRisk')] : undefined,
        irreversible: hasGitPrune,
        categoryCounts: Object.keys(categoryCounts).length > 0 ? categoryCounts : undefined,
        timestamp,
      }))
      updateStatistics({
        agentCleanupItemsRemoved: (statistics.agentCleanupItemsRemoved ?? 0) + next.removed_count,
        agentCleanupSizeFreed: (statistics.agentCleanupSizeFreed ?? 0) + next.freed_bytes,
        agentCleanupOperationCount: (statistics.agentCleanupOperationCount ?? 0) + 1,
        agentCleanupSkipped: (statistics.agentCleanupSkipped ?? 0) + (next.skipped_count ?? 0),
        agentCleanupErrors: (statistics.agentCleanupErrors ?? 0) + cleanupErrors.length,
        lastAgentCleanup: timestamp,
      })
      setResult(next)
      setGitPruneExecuted(includesGitPrune)
      await scan(true)
      // A successful refresh applies its normal defaults; after an execute
      // operation the next action must be explicit rather than preselected.
      setSelectedIds(new Set())
      toast.success(t('agentCleanup.cleanSuccess', {
        count: next.removed_count,
        size: formatFileSize(next.freed_bytes),
      }))
    } catch (cause) {
      const message = String(cause)
      setError(message)
      toast.error(t('agentCleanup.cleanFailed', { error: message }))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="stow-page-wide space-y-5">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.system')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('agentCleanup.title')}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t('agentCleanup.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void scan()} disabled={loading || executing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('agentCleanup.rescan')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-iqon-green" />{t('agentCleanup.rulesTitle')}</CardTitle>
          <CardDescription>{t('agentCleanup.rulesDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex max-w-sm items-center justify-between gap-4 text-sm font-semibold">
            <span>{t('agentCleanup.retentionDays')}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={3650}
                value={retentionInput}
                onChange={(event) => setRetentionInput(event.target.value)}
                className="h-9 w-24 rounded-xl border border-input bg-background px-3 text-right text-sm"
                aria-label={t('agentCleanup.retentionDays')}
              />
              <span className="text-xs text-muted-foreground">{t('agentCleanup.days')}</span>
            </span>
          </label>
          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
            <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-iqon-green" />{t('agentCleanup.ruleConfig')}</span>
            <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-iqon-green" />{t('agentCleanup.ruleActiveWorktrees')}</span>
            <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-iqon-green" />{t('agentCleanup.ruleCredentials')}</span>
          </div>
          <Button size="sm" onClick={() => void scan()} disabled={loading || executing}>
            <FolderSearch className="mr-2 h-4 w-4" />{t('agentCleanup.scan')}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="iqon-card flex items-start gap-3 border-iqon-yellow/30 bg-iqon-yellow/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-iqon-yellow" />
          <div className="min-w-0"><p className="font-bold text-iqon-yellow">{t('agentCleanup.errorTitle')}</p><p className="mt-1 break-words text-xs text-muted-foreground">{error}</p></div>
        </div>
      )}

      {result && (
        <div className="iqon-card flex items-start gap-3 border-iqon-green/30 bg-iqon-green/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-iqon-green" />
          <div>
            <p className="font-bold text-iqon-green">{t('agentCleanup.resultTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('agentCleanup.resultSummary', { count: result.removed_count, size: formatFileSize(result.freed_bytes) })}</p>
            {((result.skipped_count ?? 0) > 0 || (result.errors?.length ?? 0) > 0) && (
              <p className="mt-1 text-xs text-iqon-yellow">
                {t('agentCleanup.resultSkipped', { skipped: result.skipped_count ?? 0, errors: result.errors?.length ?? 0 })}
              </p>
            )}
            {gitPruneExecuted && (
              <p className="mt-1 text-xs text-iqon-red">{t('agentCleanup.gitPruneRisk')}</p>
            )}
          </div>
        </div>
      )}

      <SystemCacheCard cache={systemCache} active={active} shared />

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div><CardTitle className="text-base">{t('agentCleanup.previewTitle')}</CardTitle><CardDescription>{data ? t('agentCleanup.previewSummary', { count: data.items.length, agents: data.agents.filter((agent) => agent.available).length }) : t('agentCleanup.loading')}</CardDescription></div>
          <Button variant="outline" size="sm" onClick={toggleAll} disabled={bulkSelectableItems.length === 0 || loading || executing}>{t('agentCleanup.toggleAll')}</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && !data ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('agentCleanup.loading')}</div> : groupedItems.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">{t('agentCleanup.empty')}</div> : groupedItems.map(([groupId, items]) => {
            const [agent, category] = groupId.split(':')
            const isOpen = expanded.has(groupId)
            const selectable = items.filter((item) => !item.protected)
            const selectedCount = selectable.filter((item) => selectedIds.has(item.id)).length
            const agentDisplayName = data?.agents.find((entry) => entry.id === agent)?.name ?? agent
            return (
              <div key={groupId} className="rounded-xl border border-border/70 bg-background/40">
                <div className="flex items-center gap-2 p-3">
                  <button type="button" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(groupId)) next.delete(groupId); else next.add(groupId); return next })} className="rounded p-1 hover:bg-surface-hover" aria-label={isOpen ? t('agentCleanup.collapse') : t('agentCleanup.expand')}>
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1"><p className="text-sm font-bold">{agentDisplayName} · {categoryLabel(category as AgentCleanupCategory, t)}</p><p className="text-xs text-muted-foreground">{t('agentCleanup.groupSummary', { count: items.length, selected: selectedCount, size: formatFileSize(items.reduce((total, item) => total + item.size, 0)) })}</p></div>
                  <Button variant="ghost" size="sm" onClick={() => toggleGroup(items)} disabled={selectable.length === 0}>{t('agentCleanup.toggleGroup')}</Button>
                </div>
                {isOpen && <div className="border-t border-border/60 px-3 pb-3">{items.map((item) => (
                  <label key={item.id} className="flex items-start gap-3 border-b border-border/40 py-3 last:border-b-0">
                    <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleItem(item.id)} disabled={item.protected || executing} className="mt-1 h-4 w-4 accent-iqon-green" />
                    <div className="min-w-0 flex-1"><p className="break-all text-xs font-semibold">{item.path}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.protected ? item.reason || t('agentCleanup.protected') : item.reason || t('agentCleanup.defaultReason')} · {formatFileSize(item.size)} · {formatModifiedAt(item.modified_at)}</p></div>
                    {item.protected && <ShieldCheck className="h-4 w-4 shrink-0 text-iqon-green" />}
                  </label>
                ))}</div>}
              </div>
            )
          })}
          {data && data.protected.length > 0 && <p className="flex items-center gap-2 pt-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-iqon-green" />{t('agentCleanup.protectedSummary', { count: data.protected.length })}</p>}
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-iqon-green/25 bg-iqon-card/95 p-4 shadow-soft backdrop-blur">
        <div><p className="text-sm font-bold">{t('agentCleanup.selectedSummary', { count: selectedItems.length, size: formatFileSize(selectedBytes) })}</p><p className="text-xs text-muted-foreground">{t('agentCleanup.safeNotice')}</p></div>
        <Button variant="destructive" onClick={() => void execute()} disabled={selectedItems.length === 0 || executing || loading}>
          {executing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
          {t('agentCleanup.cleanSelected')}
        </Button>
      </div>
    </div>
  )
}
