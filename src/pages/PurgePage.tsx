import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { createCleanupHistoryRecord } from '@/lib/historyRecords'
import { deleteResultSnapshot, loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { formatFileSize } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { open } from '@tauri-apps/api/dialog'
import { open as openPath } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import { FolderOpen, Loader2, PackageX, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { MaintenanceScanCard, formatMaintenanceElapsed } from './maintenance/MaintenanceScanCard'
import { useMaintenanceScanProgress } from './maintenance/useMaintenanceScanProgress'

import { cacheablePurgePreview, canExecutePurge, isPurgePreview, purgeOutcomeMetrics, scopeKey, type MolePurgeOutcome, type MolePurgePreview } from './purge/types'

export function PurgePage() {
  const { t } = useI18n()
  const [directory, setDirectory] = useState('')
  const [includeEmpty, setIncludeEmpty] = useState(false)
  const [preview, setPreview] = useState<MolePurgePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [freshPreview, setFreshPreview] = useState(false)
  const [outcome, setOutcome] = useState<MolePurgeOutcome | null>(null)
  const requestGeneration = useRef(0)
  const executableToken = useRef<string | null>(null)
  const scope = { path: directory.trim(), includeEmpty }
  const executable = canExecutePurge(preview, scope, freshPreview)
  const sizeLabel = (size: number | null, kind?: string) => size === null
    ? t('clean.summary.unknown') : kind === 'at_least'
      ? t('clean.summary.atLeast', { size: formatFileSize(size) }) : formatFileSize(size)
  const scanElapsedMs = useMaintenanceScanProgress(loading)
  const addHistory = useAppStore((s) => s.addHistory)
  const updateStatistics = useAppStore((s) => s.updateStatistics)

  const selectDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('purge.dialogTitle'),
    })
    if (selected && typeof selected === 'string') {
      changeDirectory(selected)
    }
  }

  const changeDirectory = (path: string) => {
    requestGeneration.current += 1
    executableToken.current = null
    setDirectory(path)
    setPreview(null)
    setFreshPreview(false)
    setScanError(null)
  }

  const runPreview = async () => {
    if (loading || executing) return
    if (!directory.trim()) {
      toast.info(t('purge.needDir'))
      return
    }

    const requestedScope = { ...scope }
    const generation = ++requestGeneration.current
    executableToken.current = null
    setLoading(true)
    setScanError(null)
    setPreview(null)
    setFreshPreview(false)
    setOutcome(null)
    try {
      const next = await invoke<MolePurgePreview>('mole_purge_preview', {
        path: requestedScope.path,
        includeEmpty: requestedScope.includeEmpty,
      })
      if (generation !== requestGeneration.current) return
      if (!isPurgePreview(next) || next.requested_root !== requestedScope.path || next.include_empty !== requestedScope.includeEmpty) {
        throw new Error(t('purge.previewStale'))
      }
      setPreview(next)
      setFreshPreview(true)
      executableToken.current = next.review_token
      await saveResultSnapshot(resultCacheKeys.purgePreview(scopeKey(requestedScope)), cacheablePurgePreview(next))
      addHistory(createCleanupHistoryRecord({
        type: 'purge',
        target: next.root,
        label: t('history.type.purge'),
        itemCount: next.items.length,
        totalSize: next.total_size,
        sizeKind: next.total_size === null ? 'unknown' : 'estimated',
        action: 'preview',
        executed: false,
      }))
      if (next.items.length === 0) {
        toast.success(t('purge.noneFound'))
      }
    } catch (err) {
      if (generation !== requestGeneration.current) return
      const message = String(err)
      setScanError(t('purge.fail', { error: message }))
      toast.error(t('purge.fail', { error: message }))
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }

  const reveal = (path: string) => {
    void openPath(path).catch(() => toast.error(t('purge.openFail')))
  }

  const executeWithMole = async () => {
    if (!preview || !executable || loading || executing || executableToken.current !== preview.review_token) return
    const reviewed = preview
    const reviewedScope = { path: reviewed.requested_root, includeEmpty: reviewed.include_empty }
    if (!window.confirm(t('purge.executeConfirm', {
      count: reviewed.items.length, size: sizeLabel(reviewed.total_size, reviewed.size_kind),
    }))) return

    executableToken.current = null
    setExecuting(true)
    setFreshPreview(false)
    setOutcome(null)
    try {
      const result = await invoke<MolePurgeOutcome>('mole_purge_execute', {
        path: reviewed.root, includeEmpty: reviewed.include_empty,
        reviewToken: reviewed.review_token, confirmed: true,
      })
      setOutcome(result)
      const metrics = purgeOutcomeMetrics(result)
      const timestamp = new Date().toISOString()
      const notes: string[] = []
      if (result.outcome !== 'completed' && result.outcome !== 'no_candidates') notes.push(t('purge.partialResult'))
      if (metrics.sizeKind === 'estimated') notes.push(t('purge.estimatedResult'))
      if (metrics.itemCount === null || metrics.reportedSize === null) notes.push(t('clean.summary.executionUnknown'))
      addHistory(createCleanupHistoryRecord({
        type: 'purge', target: reviewed.root, label: t('history.type.purge'),
        itemCount: metrics.itemCount, totalSize: metrics.reportedSize, sizeKind: metrics.sizeKind,
        action: 'execute', executed: metrics.hasEvidence, timestamp, errors: notes, outcome: metrics.historyOutcome,
      }))
      if (metrics.hasEvidence) {
        const statistics = useAppStore.getState().statistics
        updateStatistics({
          cleanItemsRemoved: (statistics.cleanItemsRemoved ?? 0) + (metrics.itemCount ?? 0),
          reportedFreedBytes: (statistics.reportedFreedBytes ?? 0) + (metrics.freedBytes ?? 0),
          cleanOperationCount: (statistics.cleanOperationCount ?? 0) + 1,
          lastCleaned: timestamp,
        })
      }
      if ((result.outcome === 'completed' || result.outcome === 'no_candidates') && metrics.itemCount !== null) {
        toast.success(t('purge.executeSuccess', { count: metrics.itemCount }))
      } else {
        toast.warning(t('purge.partialResult'))
      }
    } catch (err) {
      toast.error(t('purge.executeFail', { error: String(err) }))
    } finally {
      await deleteResultSnapshot(resultCacheKeys.purgePreview(scopeKey(reviewedScope))).catch(() => {})
      setExecuting(false)
    }
  }

  useEffect(() => {
    const generation = ++requestGeneration.current
    executableToken.current = null
    const requestedScope = { path: directory.trim(), includeEmpty }
    setPreview(null)
    setFreshPreview(false)
    setOutcome(null)
    if (!requestedScope.path) return
    void loadResultSnapshot<unknown>(resultCacheKeys.purgePreview(scopeKey(requestedScope)))
      .then((snapshot) => {
        if (generation !== requestGeneration.current) return
        if (isPurgePreview(snapshot?.payload)) setPreview(snapshot.payload)
      }).catch(() => {})
    return () => { requestGeneration.current += 1 }
  }, [directory, includeEmpty])

  const scanControls = (
    <div className="rounded-2xl border bg-surface-hover/60 p-4 text-left">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={directory}
          onChange={(e) => {
            changeDirectory(e.target.value)
          }}
          placeholder={t('purge.inputPlaceholder')}
          className="font-mono text-sm"
          disabled={loading || executing}
        />
        <Button type="button" variant="secondary" onClick={() => void selectDirectory()} className="sm:w-auto" disabled={loading || executing}>
          <FolderOpen className="w-4 h-4 mr-2" />
          {t('purge.browse')}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('purge.scanScopeHint')}</p>
          <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-surface-hover/50 p-3 text-left text-sm">
            <input
              type="checkbox"
              checked={includeEmpty}
              onChange={(event) => {
                requestGeneration.current += 1
                executableToken.current = null
                setIncludeEmpty(event.target.checked)
                setPreview(null)
                setFreshPreview(false)
              }}
              disabled={loading || executing}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block font-semibold">{t('purge.includeEmpty')}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t('purge.includeEmptyDesc')}</span>
            </span>
          </label>
    </div>
  )

  // A failed refresh can leave the previous preview in state. Show the scan
  // card in that case so the error and retry action remain discoverable.
  const fullscreenScan = !preview || loading || Boolean(scanError)

  if (fullscreenScan) {
    return (
      <div className="stow-clean-fullscreen">
        <MaintenanceScanCard
          fullScreen
          actionDisabled={!directory.trim()}
          actionIcon={PackageX}
          actionLabel={scanError ? t('purge.scanAgain') : t('purge.preview')}
          description={t('purge.scanIdleDesc')}
          elapsedLabel={t('clean.scanElapsed', { time: formatMaintenanceElapsed(scanElapsedMs) })}
          errorMessage={scanError}
          idleStatus={t('purge.scanReadyStatus')}
          loading={loading}
          loadingDescription={t('purge.scanRunningDesc', {
            path: directory.trim() || t('purge.scanPathFallback'),
            time: formatMaintenanceElapsed(scanElapsedMs),
          })}
          loadingStatus={t('purge.scanRunningStatus')}
          loadingTitle={t('purge.scanRunningTitle')}
          onAction={() => void runPreview()}
          title={scanError ? t('purge.scanFailedTitle') : t('purge.scanIdleTitle')}
        >
          {scanControls}
        </MaintenanceScanCard>
      </div>
    )
  }

  return (
    <div className="stow-page">
      <div>
        <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('purge.title')}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('purge.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('purge.previewCard')}</CardTitle>
          <CardDescription>{t('purge.previewDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanControls}

          <Button onClick={() => void runPreview()} disabled={!directory.trim() || loading || executing}>
            <PackageX className="w-4 h-4 mr-2" />
            {t('purge.preview')}
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>{t('purge.resultsTitle')}</CardTitle>
            <CardDescription>
              {preview.items.length > 0
                ? t('purge.resultsDesc', {
                    count: preview.items.length,
                    size: sizeLabel(preview.total_size, preview.size_kind),
                  })
                : t('purge.emptyDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!freshPreview && <p role="status" className="text-sm text-muted-foreground">{t('purge.previewStale')}</p>}
            {outcome && <div role="status" className="rounded-xl border p-3 text-sm space-y-2">
              <p className="font-semibold">{t('purge.resultTitle')}</p>
              <p>{sizeLabel(outcome.total_size, outcome.size_kind)} · {outcome.item_count ?? t('clean.summary.unknown')}</p>
              {outcome.size_kind !== 'reported_freed' && <p>{t(outcome.size_kind === 'unknown' ? 'clean.summary.executionUnknown' : 'purge.estimatedResult')}</p>}
              {outcome.outcome !== 'completed' && outcome.outcome !== 'no_candidates' && <p>{t('purge.partialResult')}</p>}
              <details><summary>{t('purge.resultTitle')}</summary><pre className="whitespace-pre-wrap break-all text-xs">{outcome.raw_output}</pre></details>
            </div>}
            {preview.items.length > 0 && (
              <Button type="button" variant="destructive" onClick={() => void executeWithMole()} disabled={!executable || loading || executing}>
                {executing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                {t('purge.executeMole', { count: preview.items.length })}
              </Button>
            )}
            {preview.items.map((item) => (
              <div key={item.path} className="flex items-center gap-3 rounded-2xl border p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs break-all">{item.path}</p>
                </div>
                <span className="text-sm font-medium shrink-0">{sizeLabel(item.size)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => reveal(item.path)}>
                  {t('purge.open')}
                </Button>
              </div>
            ))}
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground flex items-start gap-3">
              <Terminal className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{t('purge.executeHint')}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
