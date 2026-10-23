import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { splitCleanOperationLog } from './clean/cleanExecutionResult'
import { recordCleanCompletion, type CleanCompletionInput } from './clean/cleanCompletion'
import { getCleanPreviewSummary } from './clean/cleanPreviewSummary'
import { CleanCompletedPanel } from './clean/CleanCompletedPanel'
import { CleanInteractionPrompt } from './clean/CleanInteractionPrompt'
import { PendingCleanScanCard } from './clean/PendingCleanScanCard'
import { CleanResultsPanel } from './clean/CleanResultsPanel'
import { CleanScopeControls } from './clean/CleanScopeControls'
import { CleanScanCard } from './clean/CleanScanCard'
import {
  clearPendingCleanScan,
  hasCleanPreviewContent,
  loadPendingCleanScan,
  savePendingCleanScan,
  type PendingCleanScanSnapshot,
} from './clean/cleanScanSnapshot'
import { hasDiskAccessFailure } from './clean/cleanFailureHints'
import {
  sortCleanSectionsBySize,
  type CleanCompletionResult,
  type MoleCleanExecutionResult,
  type MoleCleanPreview,
  type MoleCleanPreviewOutput,
} from './clean/types'
import { useCleanPtyInteraction, type MoleCleanInteractionRequest } from './clean/useCleanPtyInteraction'
const SCAN_IDLE_WARNING_MS = 30_000

export function CleanPage() {
  const { t } = useI18n()
  const [preview, setPreview] = useState<MoleCleanPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [activity, setActivity] = useState<'scan' | 'clean'>('scan')
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null)
  const [scanElapsedMs, setScanElapsedMs] = useState(0)
  const [scanLastOutputAt, setScanLastOutputAt] = useState<number | null>(null)
  const [scanIdleMs, setScanIdleMs] = useState(0)
  const [scanOutput, setScanOutput] = useState<string[]>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [rawOpen, setRawOpen] = useState(false)
  const [pendingScan, setPendingScan] = useState<PendingCleanScanSnapshot | null>(null)
  const [showPendingChoice, setShowPendingChoice] = useState(false)
  const [completedClean, setCompletedClean] = useState<CleanCompletionResult | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [externalPath, setExternalPath] = useState('')
  const previewScopeRef = useRef<string | null>(null)
  const cancellingRef = useRef(false)
  const cleanInteraction = useCleanPtyInteraction()
  const sections = useMemo(() => sortCleanSectionsBySize(preview?.sections ?? []), [preview])

  const changeExternalPath = (value: string) => {
    setExternalPath(value)
    if (value.trim() === previewScopeRef.current) return
    previewScopeRef.current = null
    setPreview(null)
    setCompletedClean(null)
    setScanError(null)
    setScanOutput([])
    setShowPendingChoice(false)
  }

  const finishCleanRun = (input: CleanCompletionInput) => {
    const completion = recordCleanCompletion(input, t)
    setPendingScan(null)
    setShowPendingChoice(false)
    setPreview(null)
    setCompletedClean(completion)
  }

  const cancelActiveRun = async () => {
    if (!activeRunId || !loading) return
    cancellingRef.current = true
    setCancelling(true)
    try {
      await invoke('mole_clean_preview_pty_cancel', { runId: activeRunId })
      toast.info(t(activity === 'clean' ? 'clean.cancelRequested' : 'clean.scanCancelRequested'))
    } catch (err) {
      toast.error(t('clean.interactionCancelFail', { error: String(err) }))
      cancellingRef.current = false
      setCancelling(false)
    }
  }

  const runPreview = async (scopeOverride?: string) => {
    const selectedExternalPath = scopeOverride ?? externalPath
    const startedAt = Date.now()
    const runId = `clean-${startedAt}-${Math.random().toString(36).slice(2)}`
    let unlistenOutput: (() => void) | null = null
    let unlistenInteraction: (() => void) | null = null
    setLoading(true)
    setActivity('scan')
    setActiveRunId(runId)
    cancellingRef.current = false
    setCancelling(false)
    setPreview(null)
    setCompletedClean(null)
    setScanStartedAt(startedAt)
    setScanElapsedMs(0)
    setScanLastOutputAt(startedAt)
    setScanIdleMs(0)
    setScanError(null)
    cleanInteraction.reset()
    setScanOutput([t('clean.scanStreamStarted')])

    try {
      unlistenOutput = await listen<MoleCleanPreviewOutput>('mole-clean-preview-output', (event) => {
        if (event.payload.run_id !== runId) return
        const prefix = event.payload.stream === 'stderr' ? '[stderr] ' : ''
        const line = `${prefix}${event.payload.line}`
        setScanLastOutputAt(Date.now())
        setScanIdleMs(0)
        setScanOutput((current) => [...current, line].slice(-120))
      })
      unlistenInteraction = await listen<MoleCleanInteractionRequest>('mole-clean-interaction-request', (event) => {
        if (event.payload.run_id !== runId) return
        cleanInteraction.open(event.payload)
      })
      const next = await invoke<MoleCleanPreview>('mole_clean_preview_pty', { runId, externalPath: selectedExternalPath.trim() || null })
      previewScopeRef.current = selectedExternalPath.trim()
      setPreview(next)
      setRawOpen(false)
      setScanOutput((current) => (
        current.length > 1 ? current : [...current, t('clean.scanStreamNoOutput')]
      ))
      const savedSnapshot = await savePendingCleanScan(next, selectedExternalPath)
      setPendingScan(hasCleanPreviewContent(next) ? savedSnapshot : null)
      setShowPendingChoice(false)

      if (getCleanPreviewSummary(next).empty) {
        toast.success(t('clean.noneFound'))
      }
      return next
    } catch (err) {
      const message = String(err)
      const errorLines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      if (cancellingRef.current) {
        setScanOutput((current) => [...current, t('clean.scanCancelledOutputLine'), ...errorLines].slice(-120))
        toast.info(t('clean.scanCancelled'))
        return null
      }
      setScanError(message)
      setScanOutput((current) => [...current, ...(errorLines.length ? errorLines : [message])].slice(-120))
      toast.error(t('clean.fail', { error: errorLines[0] ?? message }))
      return null
    } finally {
      unlistenOutput?.()
      unlistenInteraction?.()
      cleanInteraction.reset()
      setScanElapsedMs(Date.now() - startedAt)
      setActiveRunId(null)
      cancellingRef.current = false
      setCancelling(false)
      setLoading(false)
    }
  }

  const runClean = async () => {
    if (!preview || loading) return
    if (!getCleanPreviewSummary(preview).canClean || previewScopeRef.current !== externalPath.trim()) {
      toast.warning(t('clean.summary.rescanRequired'))
      return
    }

    const previewToArchive = preview
    const startedAt = Date.now()
    const runId = `clean-execute-${startedAt}-${Math.random().toString(36).slice(2)}`
    let unlistenOutput: (() => void) | null = null
    let unlistenInteraction: (() => void) | null = null
    let liveOutput = [t('clean.cleanStreamStarted')]

    setLoading(true)
    setActivity('clean')
    setActiveRunId(runId)
    cancellingRef.current = false
    setCancelling(false)
    setCompletedClean(null)
    setScanStartedAt(startedAt)
    setScanElapsedMs(0)
    setScanLastOutputAt(startedAt)
    setScanIdleMs(0)
    setScanError(null)
    cleanInteraction.reset()
    setScanOutput(liveOutput)

    try {
      unlistenOutput = await listen<MoleCleanPreviewOutput>('mole-clean-preview-output', (event) => {
        if (event.payload.run_id !== runId) return
        const prefix = event.payload.stream === 'stderr' ? '[stderr] ' : ''
        const line = `${prefix}${event.payload.line}`
        setScanLastOutputAt(Date.now())
        setScanIdleMs(0)
        setScanOutput((current) => {
          const next = [...current, line].slice(-160)
          liveOutput = next
          return next
        })
      })
      unlistenInteraction = await listen<MoleCleanInteractionRequest>('mole-clean-interaction-request', (event) => {
        if (event.payload.run_id !== runId) return
        cleanInteraction.open(event.payload)
      })
      const result = await invoke<MoleCleanExecutionResult>('mole_clean_execute_pty', { runId, externalPath: externalPath.trim() || null })
      if (pendingScan) {
        await clearPendingCleanScan(pendingScan.id)
      } else {
        await clearPendingCleanScan()
      }
      finishCleanRun({
        status: 'completed',
        previewToArchive,
        rawOutput: result.raw_output,
        operationLog: result.operation_log,
        outputLines: liveOutput,
        startedAt,
      })
      toast.success(t('clean.recorded'))
      return result
    } catch (err) {
      const message = String(err)
      const errorLines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      if (cancellingRef.current) {
        if (pendingScan) {
          await clearPendingCleanScan(pendingScan.id)
        } else {
          await clearPendingCleanScan()
        }
        const cancelledOutput = [t('clean.cancelledOutputLine'), ...errorLines].join('\n')
        const cancelledParts = splitCleanOperationLog(cancelledOutput)
        finishCleanRun({
          status: 'cancelled',
          previewToArchive,
          rawOutput: cancelledParts.rawOutput,
          operationLog: cancelledParts.operationLog,
          outputLines: [...liveOutput, t('clean.cancelledOutputLine'), ...errorLines],
          startedAt,
        })
        toast.info(t('clean.cancelledRecorded'))
        return null
      }
      setScanError(message)
      const hintLines = hasDiskAccessFailure(message) ? [t('clean.diskAccessFailureHint')] : []
      const displayedErrors = errorLines.length ? errorLines : [message]
      setScanOutput((current) => [...current, ...displayedErrors, ...hintLines].slice(-160))
      toast.error(t('clean.cleanFail', { error: hintLines[0] ?? errorLines[0] ?? message }))
      return null
    } finally {
      unlistenOutput?.()
      unlistenInteraction?.()
      cleanInteraction.reset()
      setActiveRunId(null)
      cancellingRef.current = false
      setCancelling(false)
      setScanElapsedMs(Date.now() - startedAt)
      setLoading(false)
    }
  }

  const viewPendingScan = () => {
    if (!pendingScan) return
    setExternalPath(pendingScan.externalPath ?? '')
    previewScopeRef.current = pendingScan.externalPath?.trim() ?? ''
    setCompletedClean(null)
    setPreview(pendingScan.preview)
    setRawOpen(false)
    setScanError(null)
    setLoading(false)
    setScanStartedAt(null)
    setScanElapsedMs(0)
    setScanLastOutputAt(null)
    setScanIdleMs(0)
    setScanOutput([t('clean.pendingLoadedOutput')])
    setShowPendingChoice(false)
  }

  const rescanPendingScan = () => {
    void (async () => {
      if (pendingScan) await clearPendingCleanScan(pendingScan.id)
      const scope = pendingScan?.externalPath ?? ''
      if (pendingScan) setExternalPath(scope)
      setPendingScan(null)
      setShowPendingChoice(false)
      setPreview(null)
      setCompletedClean(null)
      await runPreview(scope)
    })()
  }

  useEffect(() => {
    void (async () => {
      const snapshot = await loadPendingCleanScan()
      if (snapshot) {
        if (hasCleanPreviewContent(snapshot.preview)) {
          setPendingScan(snapshot)
          setShowPendingChoice(true)
          return
        }
        setExternalPath(snapshot.externalPath ?? '')
        previewScopeRef.current = snapshot.externalPath?.trim() ?? ''
        setPreview(snapshot.preview)
        setScanOutput([t('clean.pendingLoadedOutput')])
        return
      }

      await clearPendingCleanScan()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!loading || !scanStartedAt) return
    setScanElapsedMs(Date.now() - scanStartedAt)
    if (scanLastOutputAt) {
      setScanIdleMs(Date.now() - scanLastOutputAt)
    }
    const interval = window.setInterval(() => {
      const now = Date.now()
      setScanElapsedMs(now - scanStartedAt)
      if (scanLastOutputAt) {
        setScanIdleMs(now - scanLastOutputAt)
      }
    }, 1000)
    return () => window.clearInterval(interval)
  }, [loading, scanStartedAt, scanLastOutputAt])

  const scanIdle = loading && scanIdleMs >= SCAN_IDLE_WARNING_MS
  const fullscreenScan = !preview || loading
  const interactionPrompt = (
    <CleanInteractionPrompt
      open={Boolean(cleanInteraction.request)}
      kind={cleanInteraction.request?.kind ?? 'text'}
      prompt={cleanInteraction.request?.prompt ?? ''}
      value={cleanInteraction.value}
      submitting={cleanInteraction.submitting}
      onChange={cleanInteraction.setValue}
      onSubmit={(input) => void cleanInteraction.submit(input)}
      onCancel={() => void cleanInteraction.cancel()}
    />
  )

  if (completedClean && !loading) {
    return (
      <>
        <CleanCompletedPanel
          preview={completedClean.preview}
          rawOutput={completedClean.rawOutput}
          outputLines={completedClean.outputLines}
          completedAt={completedClean.completedAt}
          elapsedMs={completedClean.elapsedMs}
          status={completedClean.status}
          onRescan={() => void runPreview()}
        />
        {interactionPrompt}
      </>
    )
  }

  if (showPendingChoice && pendingScan && !loading && !preview) {
    return (
      <div className="stow-clean-fullscreen">
        <PendingCleanScanCard
          snapshot={pendingScan}
          onView={viewPendingScan}
          onRescan={rescanPendingScan}
        />
      </div>
    )
  }

  if (fullscreenScan) {
    return (
      <div className="stow-clean-fullscreen">
        <CleanScopeControls externalPath={externalPath} onExternalPathChange={changeExternalPath} disabled={loading} />
        <CleanScanCard
          fullScreen
          preview={preview}
          loading={loading}
          scanIdle={scanIdle}
          scanError={scanError}
          scanElapsedMs={scanElapsedMs}
          scanIdleMs={scanIdleMs}
          scanOutput={scanOutput}
          activity={activity}
          onScan={() => void runPreview()}
          onClean={() => void runClean()}
          onCancel={() => void cancelActiveRun()}
          cancelling={cancelling}
        />
        {interactionPrompt}
      </div>
    )
  }

  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('clean.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('clean.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <CleanScopeControls externalPath={externalPath} onExternalPathChange={changeExternalPath} disabled={loading} />
        <CleanScanCard
          preview={preview}
          loading={loading}
          scanIdle={scanIdle}
          scanError={scanError}
          scanElapsedMs={scanElapsedMs}
          scanIdleMs={scanIdleMs}
          scanOutput={scanOutput}
          activity={activity}
          onScan={() => void runPreview()}
          onClean={() => void runClean()}
          onCancel={() => void cancelActiveRun()}
          cancelling={cancelling}
        />
      </div>

      {preview && (
        <>
          <CleanResultsPanel
            preview={preview}
            sections={sections}
            onClean={() => void runClean()}
          />

          <Card>
            <button
              type="button"
              onClick={() => setRawOpen((value) => !value)}
              className="flex w-full items-center justify-between gap-3 p-6 text-left"
            >
              <span className="flex items-center gap-2 font-semibold">
                <FileText className="w-4 h-4" />
                {t('clean.rawOutput')}
              </span>
              {rawOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {rawOpen && (
              <CardContent className="pt-0">
                <pre className="max-h-96 overflow-auto rounded-2xl bg-surface-hover p-4 text-xs leading-relaxed whitespace-pre-wrap">
                  {preview.raw_output}
                </pre>
              </CardContent>
            )}
          </Card>
        </>
      )}
        {interactionPrompt}
    </div>
  )
}
