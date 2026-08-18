import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { relaunch } from '@tauri-apps/api/process'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAiActivation } from '@/hooks/useAiActivation'
import { useI18n } from '@/i18n'
import type {
  IosExecutionSession,
  IosLayoutPlan,
  IosLayoutSnapshot,
  IosProgressEvent,
  IosScanProgress,
} from '@/lib/ios'
import { hasAllHomeScreenPages } from '@/lib/ios'
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
import { useIosMirrorPreview } from './ios-organize/useIosMirrorPreview'

export function IosOrganizePage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const active = location.pathname === '/ios-organize'
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
  const [session, setSession] = useState<IosExecutionSession | null>(null)
  const [progress, setProgress] = useState<IosProgressEvent | null>(null)
  const [scanProgress, setScanProgress] = useState<IosScanProgress | null>(null)
  const [template, setTemplate] = useState('efficiency')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    setError(null)
    setMirrorMode('interaction')
  }
  const exitMirrorInteraction = () => {
    setMirrorMode('preview')
    if (!snapshot) return
    setSnapshotStale(true)
    setVerification(null)
    setPlan(null)
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
    const listeners = [
      listen<IosScanProgress>('ios-scan-progress', (event) => setScanProgress(event.payload)),
      listen<IosProgressEvent>('ios-execution-progress', (event) => {
        setProgress(event.payload)
        setSession((current) => ({
          id: event.payload.sessionId,
          planId: current?.planId ?? '',
          status: 'running',
          currentIndex: event.payload.current,
          total: event.payload.total,
          createdAt: current?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          guidanceCanResume: false,
        }))
      }),
      listen<IosExecutionSession>('ios-execution-paused', (event) => {
        setSession(event.payload)
        setBusy(false)
      }),
      listen<IosExecutionSession>('ios-execution-completed', (event) => {
        setSession(event.payload)
        setBusy(false)
      }),
      listen<IosExecutionSession>('ios-execution-failed', (event) => {
        setSession(event.payload)
        setError(event.payload.error ?? t('iosOrganize.error.execution'))
        setBusy(false)
      }),
    ]
    return () => {
      for (const listener of listeners) {
        void listener.then((unlisten) => unlisten())
      }
    }
  }, [t])

  useEffect(() => {
    const ready = capabilities?.mirrorContentReady ?? false
    const previousReady = previousMirrorReadyRef.current
    previousMirrorReadyRef.current = ready
    if (previousReady !== true || ready || !snapshot) return

    setSnapshotStale(true)
    setVerification(null)
    setPlan(null)
  }, [capabilities?.mirrorContentReady, snapshot])

  const currentStep = useMemo<IosOrganizeStep>(() => {
    if (session && !['completed', 'failed', 'cancelled'].includes(session.status)) return 'execute'
    if (!capabilities?.mirrorRunning) return 'connect'
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

  const openPermissionSettings = async (permission: 'accessibility' | 'screenRecording') => {
    setError(null)
    try {
      const granted = await invoke<boolean>('ios_request_permission', { permission })
      await refreshCapabilities()
      if (!granted) {
        await invoke('ios_open_permission_settings', { permission })
      }
    } catch (cause) {
      setError(String(cause))
    }
  }

  const revealCurrentApp = async () => {
    setError(null)
    try {
      await invoke('ios_reveal_current_app')
    } catch (cause) {
      setError(String(cause))
    }
  }

  const restartApp = async () => {
    setError(null)
    try {
      await relaunch()
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
    if (!requirePreviewMode()) return
    setBusy(true)
    setError(null)
    setScanProgress({ current: 0, total: 100, message: t('iosOrganize.scan.starting') })
    try {
      if (session && !['completed', 'failed', 'cancelled'].includes(session.status)) {
        await invoke('ios_cancel_execution', { sessionId: session.id })
      }
      const result = await invoke<IosLayoutSnapshot>('ios_scan_inventory', {
        request: { deviceName: null },
      })
      setSnapshot(result)
      setSnapshotStale(false)
      setVerification(null)
      setPlan(null)
      setSession(null)
      setProgress(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const createPlan = async () => {
    if (!requirePreviewMode()) return
    if (!snapshot || snapshotStale) return
    if (!hasAllHomeScreenPages(snapshot)) {
      setError(t('iosOrganize.error.fullInventoryRequired'))
      return
    }
    setBusy(true)
    setError(null)
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
      setVerification(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const prepareRestore = async () => {
    if (!requirePreviewMode()) return
    if (!snapshot || snapshotStale || !restoreRecord?.iosSnapshotId) return
    setBusy(true)
    setError(null)
    try {
      const result = await invoke<IosLayoutPlan>('ios_prepare_restore', {
        currentSnapshotId: snapshot.id,
        targetSnapshotId: restoreRecord.iosSnapshotId,
      })
      setPlan(result)
      setSession(null)
      setVerification(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (!requirePreviewMode()) return
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
    try {
      const result = await invoke<IosExecutionSession>('ios_start_execution', {
        request: { planId: plan.id },
      })
      setSession(result)
      if (result.status === 'completed') recordCompletion(result)
    } catch (cause) {
      setError(String(cause))
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
    try {
      setSession(await invoke<IosExecutionSession>('ios_cancel_execution', { sessionId: session.id }))
      setBusy(false)
    } catch (cause) {
      setError(String(cause))
    }
  }

  const resume = async () => {
    if (!session || snapshotStale) {
      setError(t('iosOrganize.visual.snapshotStale'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await invoke<IosExecutionSession>('ios_resume_execution', { sessionId: session.id })
      setSession(result)
      if (result.status === 'completed') recordCompletion(result)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!requirePreviewMode()) return
    setBusy(true)
    setError(null)
    try {
      const result = await invoke<IosLayoutSnapshot>('ios_scan_inventory', {
        request: { deviceName: snapshot?.deviceName ?? null },
      })
      setVerification(result)
      if (snapshot && result.inventoryHash !== snapshot.inventoryHash) {
        setError(t('iosOrganize.error.inventoryChanged'))
      }
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const actionPanel = (
    <IosOrganizeActionPanel
      currentStep={currentStep}
      capabilities={capabilities}
      canScan={canScan && mirrorMode === 'preview'}
      canExecute={canExecute}
      busy={busy}
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
      onOpenPermissionSettings={openPermissionSettings}
      onRevealCurrentApp={revealCurrentApp}
      onRestartApp={restartApp}
      onRefreshCapabilities={refreshCapabilities}
      onScan={scan}
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

      <main className="grid items-start gap-5 xl:grid-cols-[minmax(560px,1.18fr)_minmax(360px,0.82fr)]">
        <IosDeviceStage
          previewRef={previewRef}
          previewState={previewState}
          previewError={previewError}
          snapshot={snapshot}
          capabilities={capabilities}
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
