import { invoke } from '@tauri-apps/api/tauri'
import { relaunch } from '@tauri-apps/api/process'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAiActivation } from '@/hooks/useAiActivation'
import { useI18n } from '@/i18n'
import type {
  IosExecutionSession,
  IosLayoutPlan,
  IosLayoutSnapshot,
} from '@/lib/ios'
import { getIosVerificationError, hasAllHomeScreenPages } from '@/lib/ios'
import { useAppStore } from '@/stores/app'
import { IosOrganizeActionPanel } from './ios-organize/IosOrganizeActionPanel'
import { IosMirrorInteractionCompanion } from './ios-organize/IosMirrorInteractionCompanion'
import { IosOrganizerControlDeck } from './ios-organize/IosOrganizerControlDeck'
import {
  IosDeviceStage,
  IosOrganizerHeader,
  Warning,
  WorkflowRail,
  type IosOrganizeStep,
} from './ios-organize/IosOrganizeComponents'
import { useIosCapabilities } from './ios-organize/useIosCapabilities'
import { useIosExecutionEvents } from './ios-organize/useIosExecutionEvents'
import { useIosInventory } from './ios-organize/useIosInventory'
import { useIosMirrorPreview } from './ios-organize/useIosMirrorPreview'
import { useIosOrganizerLifecycle } from './ios-organize/useIosOrganizerLifecycle'

export function IosOrganizePage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const active = location.pathname === '/ios-organize'
  useIosOrganizerLifecycle(active)
  const aiProvider = useAppStore((state) => state.aiProvider)
  const {
    enabled: useAi,
    status: aiStatus,
    issue: aiIssue,
    setEnabled: setAiEnabled,
  } = useAiActivation(aiProvider)
  const aiOnlyHardCases = useAppStore((state) => state.aiOnlyHardCases)
  const history = useAppStore((state) => state.history)
  const addHistory = useAppStore((state) => state.addHistory)
  const {
    capabilities,
    capabilityError,
    canScan,
    canExecute,
    refreshCapabilities,
  } = useIosCapabilities(active)
  const [snapshot, setSnapshot] = useState<IosLayoutSnapshot | null>(null)
  const [snapshotStale, setSnapshotStale] = useState(false)
  const [verification, setVerification] = useState<IosLayoutSnapshot | null>(null)
  const [plan, setPlan] = useState<IosLayoutPlan | null>(null)
  const [template, setTemplate] = useState('efficiency')
  const [busy, setBusyState] = useState(false)
  const { scanning, runInventory, cancelInventory } = useIosInventory()
  const requestBusyRef = useRef(false)
  const setBusy = (value: boolean) => {
    requestBusyRef.current = value
    setBusyState(value)
  }
  const [error, setError] = useState<string | null>(null)
  const { session, setSession, progress, setProgress, scanProgress, setScanProgress, markCancellation, cancellationRequested } = useIosExecutionEvents({
    planId: plan?.id,
    clearVerification: () => setVerification(null),
    setBusy: (value) => setBusyState(value || requestBusyRef.current),
    setError,
    executionError: t('iosOrganize.error.execution'),
  })
  const [mirrorMode, setMirrorMode] = useState<'preview' | 'interaction'>('preview')
  const previousMirrorReadyRef = useRef<boolean | null>(null)
  const {
    previewRef,
    previewState,
    previewError,
    refreshPreview,
  } = useIosMirrorPreview({
    active,
    enabled: mirrorMode === 'preview' && Boolean(
      capabilities?.mirrorRunning
        && capabilities.helperAvailable
        && capabilities.screenRecordingGranted
    ),
  })

  useEffect(() => {
    if (!active || mirrorMode !== 'interaction') {
      delete document.documentElement.dataset.iosMirrorInteraction
      return
    }

    let disposed = false
    document.documentElement.dataset.iosMirrorInteraction = 'true'
    void invoke('ios_enter_mirror_interaction').catch((cause) => {
      if (disposed) return
      setError(String(cause))
      setMirrorMode('preview')
    })
    return () => {
      disposed = true
      delete document.documentElement.dataset.iosMirrorInteraction
      void invoke('ios_exit_mirror_interaction').catch(() => undefined)
    }
  }, [active, mirrorMode])

  const enterMirrorInteraction = () => {
    if (requestBusyRef.current || session?.status === 'running' || session?.status === 'pending') return
    setError(null)
    setVerification(null)
    setMirrorMode('interaction')
  }
  const exitMirrorInteraction = () => {
    if (requestBusyRef.current || session?.status === 'running' || session?.status === 'pending') return
    setMirrorMode('preview')
    if (!snapshot) return
    setSnapshotStale(true)
    setVerification(null)
    // A completed plan remains an immutable verification target. A fresh scan
    // still has to prove the entire layout; stale coordinates cannot execute.
    if (session?.status !== 'completed') setPlan(null)
  }

  const steps = useMemo<{ id: IosOrganizeStep; label: string; description: string }[]>(
    () => [
      { id: 'connect', label: t('iosOrganize.step.connect'), description: t('iosOrganize.step.connectDesc') },
      { id: 'scan', label: t('iosOrganize.step.scan'), description: t('iosOrganize.step.scanDesc') },
      { id: 'plan', label: t('iosOrganize.step.plan'), description: t('iosOrganize.step.planDesc') },
      { id: 'preview', label: t('iosOrganize.step.preview'), description: t('iosOrganize.step.previewDesc') },
      { id: 'execute', label: t('iosOrganize.step.execute'), description: t('iosOrganize.step.executeDesc') },
      { id: 'verify', label: t('iosOrganize.step.verify'), description: t('iosOrganize.step.verifyDesc') },
    ],
    [t]
  )
  const restoreRecord = useMemo(
    () => history.find((record) => record.type === 'ios-organize' && record.iosSnapshotId), [history]
  )

  useEffect(() => {
    // An unavailable probe is not evidence that the mirror disconnected.
    if (!capabilities) return
    const ready = capabilities.mirrorContentReady
    const previousReady = previousMirrorReadyRef.current
    previousMirrorReadyRef.current = ready
    if (previousReady !== true || ready || !snapshot) return

    setSnapshotStale(true)
    setVerification(null)
    if (session?.status !== 'completed') setPlan(null)
  }, [capabilities?.mirrorContentReady, session?.status, snapshot])

  const currentStep = useMemo<IosOrganizeStep>(() => {
    if (session && session.status !== 'completed') return 'execute'
    if (!capabilities?.mirrorRunning) return 'connect'
    if (session?.status === 'completed' && plan) return 'verify'
    if (!capabilities.mirrorContentReady || snapshotStale) return 'scan'
    if (snapshot && !hasAllHomeScreenPages(snapshot)) return 'scan'
    if (verification || session?.status === 'completed') return 'verify'
    if (plan) return 'preview'
    if (snapshot) return 'plan'
    return 'scan'
  }, [capabilities?.mirrorContentReady, capabilities?.mirrorRunning, plan, session, snapshot, snapshotStale, verification])
  const currentStepIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep))
  const currentStepMeta = steps[currentStepIndex]
  const recordCompletion = (result: IosExecutionSession) => {
    if (!plan?.operations.length || result.planId !== plan.id
      || result.total !== plan.operations.length || result.currentIndex !== result.total) return
    if (history.some((record) => record.iosSessionId === result.id)) return
    addHistory({
      type: 'ios-organize',
      id: result.id,
      timestamp: new Date().toISOString(),
      directory: snapshot?.deviceName ?? 'iPhone Mirroring',
      totalFiles: result.total,
      categories: {},
      executed: true,
      moves: [],
      iosSessionId: result.id,
      iosSnapshotId: plan?.sourceSnapshotId ?? snapshot?.id,
    })
  }

  const openMirroring = async () => {
    if (requestBusyRef.current) return
    setBusy(true)
    setError(null)
    try {
      await invoke('ios_open_mirroring')
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await refreshCapabilities()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const openPermissionSettings = (permission: 'accessibility' | 'screenRecording') =>
    runConnectionAction(async () => {
      const granted = await invoke<boolean>('ios_request_permission', { permission })
      await refreshCapabilities()
      if (!granted) {
        await invoke('ios_open_permission_settings', { permission })
      }
    })

  const runConnectionAction = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(String(cause))
    }
  }

  const requirePreviewMode = () => {
    if (mirrorMode === 'preview') return true
    setError(t('iosOrganize.error.exitInteractionFirst'))
    return false
  }

  const scan = async () => {
    if (requestBusyRef.current || !requirePreviewMode()) return
    setBusy(true)
    setError(null)
    setVerification(null)
    setSnapshotStale(true)
    setScanProgress({ current: 0, total: 100, message: t('iosOrganize.scan.starting') })
    try {
      const result = await runInventory(null, async () => {
        if (session && !['completed', 'failed', 'cancelled'].includes(session.status)) {
          markCancellation(session.id)
          await invoke('ios_cancel_execution', { sessionId: session.id })
        }
      })
      if (!result) return
      setSnapshot(result)
      setSnapshotStale(false)
      setPlan(null)
      setSession(null)
      setProgress(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const cancelScan = async () => {
    try {
      return await cancelInventory()
    } catch (cause) {
      setError(String(cause))
      return false
    }
  }

  const createPlan = async () => {
    if (requestBusyRef.current || !requirePreviewMode()) return
    if (!snapshot || snapshotStale) return
    if (!hasAllHomeScreenPages(snapshot)) {
      setError(t('iosOrganize.error.fullInventoryRequired'))
      return
    }
    setBusy(true)
    setError(null)
    setVerification(null)
    try {
      const result = await invoke<IosLayoutPlan>('ios_create_plan', {
        request: {
          snapshotId: snapshot.id,
          template,
          useAi,
          aiOnlyHardCases,
          aiProvider: useAi ? aiProvider : null,
        },
      })
      setPlan(result)
      setSession(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const prepareRestore = async () => {
    if (requestBusyRef.current || !requirePreviewMode()) return
    if (!snapshot || snapshotStale || !restoreRecord?.iosSnapshotId) return
    setBusy(true)
    setError(null)
    setVerification(null)
    try {
      const result = await invoke<IosLayoutPlan>('ios_prepare_restore', {
        currentSnapshotId: snapshot.id,
        targetSnapshotId: restoreRecord.iosSnapshotId,
      })
      setPlan(result)
      setSession(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (requestBusyRef.current || !requirePreviewMode()) return
    if (!plan || snapshotStale) {
      setError(t('iosOrganize.visual.snapshotStale'))
      return
    }
    if (plan.operations.length === 0) {
      setError(t('iosOrganize.error.noOperations'))
      return
    }
    if (!window.confirm(t('iosOrganize.confirmExecute'))) return
    setBusy(true)
    setError(null)
    setVerification(null)
    try {
      const result = await invoke<IosExecutionSession>('ios_start_execution', {
        request: { planId: plan.id },
      })
      if (setSession(result) && result.status === 'completed') recordCompletion(result)
    } catch (cause) {
      if (!cancellationRequested()) setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const pause = async () => {
    if (!session) return
    try {
      setSession(await invoke<IosExecutionSession>('ios_pause_execution', { sessionId: session.id }))
    } catch (cause) {
      setError(String(cause))
    }
  }

  const cancel = async () => {
    if (!session) return
    markCancellation(session.id)
    setVerification(null)
    try {
      setSession(await invoke<IosExecutionSession>('ios_cancel_execution', { sessionId: session.id }))
      setBusyState(requestBusyRef.current)
    } catch (cause) {
      setError(String(cause))
    }
  }

  const resume = async () => {
    if (requestBusyRef.current) return
    if (!session || snapshotStale) {
      setError(t('iosOrganize.visual.snapshotStale'))
      return
    }
    setBusy(true)
    setError(null)
    setVerification(null)
    try {
      const result = await invoke<IosExecutionSession>('ios_resume_execution', { sessionId: session.id })
      if (setSession(result) && result.status === 'completed') recordCompletion(result)
    } catch (cause) {
      if (!cancellationRequested()) setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (requestBusyRef.current || !requirePreviewMode()) return
    setBusy(true)
    setError(null)
    setVerification(null)
    try {
      const result = await runInventory(snapshot?.deviceName ?? null)
      if (!result) return
      setVerification(result)
      const issue = getIosVerificationError(snapshot, plan, session, result, snapshotStale)
      if (issue) setError(t(issue))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const actionPanel = (
    <IosOrganizeActionPanel
      currentStep={currentStep}
      mirrorMode={mirrorMode}
      capabilities={capabilities}
      canScan={canScan && mirrorMode === 'preview'}
      canExecute={canExecute}
      busy={busy}
      scanning={scanning}
      scanProgress={scanProgress}
      snapshot={snapshot}
      snapshotStale={snapshotStale}
      template={template}
      useAi={useAi}
      aiStatus={aiStatus}
      aiIssue={aiIssue}
      aiProvider={aiProvider}
      hasRestoreSnapshot={Boolean(restoreRecord?.iosSnapshotId)}
      plan={plan}
      session={session}
      progress={progress}
      verification={verification}
      onTemplateChange={setTemplate}
      onAiEnabledChange={setAiEnabled}
      onOpenAiSettings={() => navigate('/settings#ai-settings')}
      onOpenMirroring={openMirroring}
      onEnterInteraction={enterMirrorInteraction}
      onExitInteraction={exitMirrorInteraction}
      onOpenPermissionSettings={openPermissionSettings}
      onRevealCurrentApp={() => runConnectionAction(() => invoke('ios_reveal_current_app'))}
      onRestartApp={() => runConnectionAction(relaunch)}
      onRefreshCapabilities={refreshCapabilities}
      onScan={scan}
      onCancelScan={cancelScan}
      onCreatePlan={createPlan}
      onPrepareRestore={prepareRestore}
      onExecute={execute}
      onChangePlan={() => setPlan(null)}
      onPause={pause}
      onResume={resume}
      onCancel={cancel}
      onVerify={verify}
    />
  )
  const warning = error || capabilityError ? <Warning text={error ?? capabilityError ?? ''} /> : null

  if (mirrorMode === 'interaction') {
    return (
      <IosMirrorInteractionCompanion
        step={currentStepMeta}
        stepNumber={currentStepIndex + 1}
        totalSteps={steps.length}
        error={warning}
        busy={busy || session?.status === 'running' || session?.status === 'pending'}
        onExit={exitMirrorInteraction}
      >
        {actionPanel}
      </IosMirrorInteractionCompanion>
    )
  }

  return (
    <div className="stow-page-wide ios-organizer-page">
      <IosOrganizerHeader
        busy={busy}
        onOpenMirroring={() => void openMirroring()}
        onRefresh={() => void refreshCapabilities()}
      />

      <WorkflowRail steps={steps} current={currentStep} />

      <main className="grid items-start gap-5 lg:grid-cols-[minmax(300px,1fr)_minmax(320px,0.9fr)]">
        <IosDeviceStage
          previewRef={previewRef}
          previewState={previewState}
          previewError={previewError}
          snapshot={snapshot}
          capabilities={capabilities}
          interactionDisabled={busy || requestBusyRef.current || session?.status === 'running' || session?.status === 'pending'}
          onRefreshPreview={refreshPreview}
          onEnterInteraction={enterMirrorInteraction}
        />

        <IosOrganizerControlDeck
          step={currentStepMeta}
          stepNumber={currentStepIndex + 1}
          totalSteps={steps.length}
          warning={error ?? capabilityError}
          snapshot={snapshot}
          snapshotStale={snapshotStale}
          busy={busy}
          canScan={canScan}
          onScan={() => void scan()}
        >
          {actionPanel}
        </IosOrganizerControlDeck>
      </main>
    </div>
  )
}
