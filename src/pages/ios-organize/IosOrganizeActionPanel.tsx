import {
  Bot,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Grid2X2,
  Loader2,
  MousePointer2,
  LockKeyhole,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Shield,
  ShieldCheck,
  Sparkles,
  StopCircle,
} from 'lucide-react'
import { AiSetupGuide } from '@/components/AiSetupGuide'
import { IosPlanPreview } from './IosPlanPreview'
import { IosScanActivity } from './IosScanActivity'
import type { AiActivationStatus } from '@/hooks/useAiActivation'
import { useI18n } from '@/i18n'
import type { AiSetupIssue } from '@/lib/aiProvider'
import type {
  IosDeviceCapabilities,
  IosExecutionSession,
  IosLayoutPlan,
  IosLayoutSnapshot,
  IosProgressEvent,
  IosScanProgress,
} from '@/lib/ios'
import { getIosVerificationError, hasAllHomeScreenPages } from '@/lib/ios'
import type { AIProvider } from '@/stores/app'
import {
  Capability,
  ProgressBar,
  Warning,
  type IosOrganizeStep,
} from './IosOrganizeComponents'

type PermissionTarget = 'accessibility' | 'screenRecording'
type Action = () => void | Promise<unknown>

interface IosOrganizeActionPanelProps {
  currentStep: IosOrganizeStep
  capabilities: IosDeviceCapabilities | null
  canScan: boolean
  canExecute: boolean
  busy: boolean
  scanning: boolean
  mirrorMode: 'preview' | 'interaction'
  onEnterInteraction: Action
  onExitInteraction: Action
  onCancelScan: Action
  scanProgress: IosScanProgress | null
  snapshot: IosLayoutSnapshot | null
  snapshotStale: boolean
  template: string
  useAi: boolean
  aiStatus: AiActivationStatus
  aiIssue: AiSetupIssue | null
  aiProvider: AIProvider
  hasRestoreSnapshot: boolean
  plan: IosLayoutPlan | null
  session: IosExecutionSession | null
  progress: IosProgressEvent | null
  verification: IosLayoutSnapshot | null
  onTemplateChange: (template: string) => void
  onAiEnabledChange: (enabled: boolean) => Promise<boolean>
  onOpenAiSettings: Action
  onOpenMirroring: Action
  onOpenPermissionSettings: (permission: PermissionTarget) => void | Promise<unknown>
  onRevealCurrentApp: Action
  onRestartApp: Action
  onRefreshCapabilities: Action
  onScan: Action
  onCreatePlan: Action
  onPrepareRestore: Action
  onExecute: Action
  onChangePlan: Action
  onPause: Action
  onResume: Action
  onCancel: Action
  onVerify: Action
}

export function IosOrganizeActionPanel({
  currentStep,
  capabilities,
  canScan,
  canExecute,
  busy,
  scanning = false,
  mirrorMode = 'preview',
  onEnterInteraction,
  onExitInteraction,
  onCancelScan,
  scanProgress,
  snapshot,
  snapshotStale,
  template,
  useAi,
  aiStatus,
  aiIssue,
  aiProvider,
  hasRestoreSnapshot,
  plan,
  session,
  progress,
  verification,
  onTemplateChange,
  onAiEnabledChange,
  onOpenAiSettings,
  onOpenMirroring,
  onOpenPermissionSettings,
  onRevealCurrentApp,
  onRestartApp,
  onRefreshCapabilities,
  onScan,
  onCreatePlan,
  onPrepareRestore,
  onExecute,
  onChangePlan,
  onPause,
  onResume,
  onCancel,
  onVerify,
}: IosOrganizeActionPanelProps) {
  const { t } = useI18n()
  const scanPermission = capabilities?.mirrorRunning && capabilities.helperAvailable
    && !capabilities.screenRecordingGranted
    ? 'screenRecording'
    : null
  const executionPermission = capabilities?.mirrorRunning && capabilities.helperAvailable
    ? !capabilities.screenRecordingGranted
      ? 'screenRecording'
      : !capabilities.accessibilityGranted
        ? 'accessibility'
        : null
    : null
  const mirrorStatusWarning = capabilities?.mirrorRunning
    && capabilities.screenRecordingGranted
    && !capabilities.mirrorContentReady
    ? capabilities.mirrorConnectionState === 'paused'
      ? t('iosOrganize.visual.previewPaused')
      : t('iosOrganize.visual.previewBlocked')
    : null
  const executionWarning = mirrorStatusWarning ?? capabilities?.executionMessage
  const fullHomeScreenInventory = hasAllHomeScreenPages(snapshot)
  const verificationPassed = Boolean(verification && !busy && canScan
    && getIosVerificationError(snapshot, plan, session, verification, snapshotStale) === null)
  const permissionAction = (permission: PermissionTarget | null) => permission
    ? {
        actionLabel: permission === 'accessibility'
          ? t('iosOrganize.permission.accessibility')
          : t('iosOrganize.permission.screenRecording'),
        onAction: () => void onOpenPermissionSettings(permission),
      }
    : {}

  if (scanning) return <IosScanActivity onCancel={onCancelScan} />

  if (mirrorMode === 'interaction' && !['running', 'paused'].includes(session?.status ?? '')) {
    return (
      <>
        <p className="text-sm font-bold">{t('iosOrganize.interaction.finishEditing')}</p>
        <p className="text-xs leading-5 text-muted-foreground">{t('iosOrganize.interaction.finishHelp')}</p>
        <button type="button" className="iqon-btn-primary min-h-11 w-full justify-center" onClick={() => void onExitInteraction()} disabled={busy}>
          {t(session?.status === 'completed' ? 'iosOrganize.interaction.returnVerify' : 'iosOrganize.interaction.returnScan')}
        </button>
      </>
    )
  }

  if (currentStep === 'connect') {
    return (
      <>
        <div className="grid gap-2 sm:grid-cols-2">
          <Capability label={t('iosOrganize.capability.macos')} ok={capabilities?.platformSupported ?? false} ready={t('iosOrganize.ready')} pending={t('iosOrganize.pending')} />
          <Capability label={t('iosOrganize.capability.mirror')} ok={Boolean(capabilities?.mirrorRunning && capabilities.mirrorContentReady)} ready={t('iosOrganize.ready')} pending={t('iosOrganize.pending')} />
          <Capability label={t('iosOrganize.capability.accessibility')} ok={capabilities?.accessibilityGranted ?? false} ready={t('iosOrganize.ready')} pending={t('iosOrganize.pending')} />
          <Capability label={t('iosOrganize.capability.recording')} ok={capabilities?.screenRecordingGranted ?? false} ready={t('iosOrganize.ready')} pending={t('iosOrganize.pending')} />
          <Capability label={t('iosOrganize.capability.helper')} ok={capabilities?.helperAvailable ?? false} ready={t('iosOrganize.ready')} pending={t('iosOrganize.pending')} />
        </div>
        {(mirrorStatusWarning || capabilities?.message) && (
          <Warning text={mirrorStatusWarning ?? capabilities?.message ?? ''} {...permissionAction(scanPermission)} />
        )}
        <button type="button" className="iqon-btn-primary min-h-11 w-full justify-center" onClick={() => void onOpenMirroring()} disabled={busy}>
          <ExternalLink className="h-4 w-4" />
          {t('iosOrganize.openMirroring')}
        </button>
      </>
    )
  }

  if (currentStep === 'scan') {
    return (
      <>
        <div className="ios-readonly-callout">
          <ScanLine className="h-5 w-5 text-iqon-green" />
          <div>
            <p className="text-sm font-bold text-foreground">{t('iosOrganize.visual.readOnlyTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('iosOrganize.visual.readOnlyDesc')}</p>
          </div>
        </div>
        {scanProgress && busy && (
          <ProgressBar label={scanProgress.message} current={scanProgress.current} total={scanProgress.total} />
        )}
        {snapshotStale && (
          <Warning text={t('iosOrganize.visual.snapshotStale')} />
        )}
        {!canScan && (mirrorStatusWarning || capabilities?.message) && (
          <Warning text={mirrorStatusWarning ?? capabilities?.message ?? ''} {...permissionAction(scanPermission)} />
        )}
        {!canScan && capabilities?.debugBuild && (
          <div className="rounded-2xl border border-iqon-border bg-iqon-row p-3">
            {capabilities.appBundlePath && (
              <p className="break-all font-mono text-[9px] leading-4 text-muted-foreground">
                {capabilities.appBundlePath}
              </p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button type="button" className="iqon-btn-secondary min-h-10 justify-center" onClick={() => void onRevealCurrentApp()}>
                <FolderOpen className="h-4 w-4" />
                {t('iosOrganize.permission.revealDebugApp')}
              </button>
              <button type="button" className="iqon-btn-secondary min-h-10 justify-center" onClick={() => void onRestartApp()}>
                <RefreshCw className="h-4 w-4" />
                {t('iosOrganize.permission.restartAfterGrant')}
              </button>
            </div>
          </div>
        )}
        {canScan && !canExecute && (
          <Warning
            text={t('iosOrganize.permission.scanWithoutAccessibility')}
            {...permissionAction('accessibility')}
          />
        )}
        {snapshot && !fullHomeScreenInventory && capabilities?.accessibilityGranted && (
          <Warning text={t('iosOrganize.error.fullInventoryRequired')} />
        )}
        <button type="button" className="iqon-btn-primary min-h-11 w-full justify-center" onClick={() => void onScan()} disabled={busy || !canScan}>
          <LockKeyhole className="h-4 w-4" />
          {capabilities?.accessibilityGranted
            ? t('iosOrganize.scanAllPages')
            : t('iosOrganize.scanVisiblePage')}
        </button>
        {!canScan && (
          <button type="button" className="iqon-btn-secondary min-h-11 w-full justify-center" onClick={() => void onRefreshCapabilities()} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
            {t('iosOrganize.refresh')}
          </button>
        )}
      </>
    )
  }

  if (currentStep === 'plan') {
    const templates = [
      { id: 'efficiency', label: t('iosOrganize.template.efficiency'), description: t('iosOrganize.template.efficiencyDesc'), Icon: Grid2X2 },
      { id: 'minimal', label: t('iosOrganize.template.minimal'), description: t('iosOrganize.template.minimalDesc'), Icon: Minimize2 },
      { id: 'work', label: t('iosOrganize.template.work'), description: t('iosOrganize.template.workDesc'), Icon: Briefcase },
      { id: 'privacy', label: t('iosOrganize.template.privacy'), description: t('iosOrganize.template.privacyDesc'), Icon: Shield },
    ]
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          {templates.map(({ id, label, description, Icon }) => (
            <button
              key={id}
              type="button"
              className="ios-template-option"
              data-selected={template === id}
              aria-pressed={template === id}
              disabled={busy}
              onClick={() => onTemplateChange(id)}
            >
              <Icon className="h-4 w-4" />
              <span className="mt-3 block text-xs font-bold">{label}</span>
              <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={useAi}
          className="ios-ai-option"
          data-enabled={useAi}
          disabled={busy || aiStatus === 'checking'}
          onClick={() => void onAiEnabledChange(!useAi)}
        >
          <span className="ios-ai-icon">
            <Bot className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-xs font-bold text-foreground">{t('iosOrganize.aiTitle')}</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{t('iosOrganize.aiDesc')}</span>
          </span>
          <span className="iqon-toggle" data-active={useAi} aria-hidden="true" />
        </button>
        {aiStatus !== 'off' && (
          <AiSetupGuide
            provider={aiProvider}
            status={aiStatus}
            issue={aiIssue}
            onOpenSettings={() => void onOpenAiSettings()}
          />
        )}
        <button type="button" className="iqon-btn-primary min-h-11 w-full justify-center" onClick={() => void onCreatePlan()} disabled={busy || !snapshot || !fullHomeScreenInventory || aiStatus === 'checking'}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}
          {t(busy ? 'iosOrganize.plan.creating' : 'iosOrganize.createPlan')}
        </button>
        {hasRestoreSnapshot && snapshot && (
          <button type="button" className="iqon-btn-secondary min-h-11 w-full justify-center" onClick={() => void onPrepareRestore()} disabled={busy}>
            <RotateCcw className="h-4 w-4" />
            {t('iosOrganize.prepareRestore')}
          </button>
        )}
      </>
    )
  }

  if (currentStep === 'preview' && plan) {
    return (
      <IosPlanPreview plan={plan} snapshot={snapshot} busy={busy} canExecute={canExecute}
        canScan={canScan} hasSession={Boolean(session)} onExecute={onExecute}
        onChangePlan={onChangePlan} onScan={onScan}>
        {!canExecute && executionWarning && <Warning text={executionWarning} {...permissionAction(executionPermission)} />}
      </IosPlanPreview>
    )
  }

  if (currentStep === 'execute' && session) {
    const statusLabel = t(`iosOrganize.status.${session.status}`)
    return (
      <>
        <div className="ios-execution-status" data-status={session.status}>
          <span className="ios-execution-pulse" />
          <div>
            <p className="text-sm font-bold text-foreground">{statusLabel}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{t('iosOrganize.visual.batchSafety')}</p>
          </div>
        </div>
        {progress && <ProgressBar label={progress.message} current={progress.current} total={progress.total} />}
        {session.status === 'paused' && (
          <Warning text={session.guidanceMessage ?? t('iosOrganize.guidanceDefault')} />
        )}
        {session.status === 'paused' && session.guidanceCanResume && mirrorMode === 'preview' && (
          <button type="button" className="iqon-btn-primary min-h-11 w-full justify-center" onClick={() => void onEnterInteraction()} disabled={busy || !capabilities?.mirrorRunning}>
            <MousePointer2 className="h-4 w-4" />{t('iosOrganize.interaction.followGuidance')}
          </button>
        )}
        {snapshotStale && (
          <Warning text={t('iosOrganize.visual.snapshotStale')} />
        )}
        {session.status === 'paused' && session.guidanceCanResume && !canExecute && executionWarning && (
          <Warning text={executionWarning} {...permissionAction(executionPermission)} />
        )}
        <div className="grid grid-cols-2 gap-2">
          {session.status === 'running' && (
            <button type="button" className="iqon-btn-secondary min-h-11 justify-center" onClick={() => void onPause()}>
              <Pause className="h-4 w-4" />
              {t('iosOrganize.pause')}
            </button>
          )}
          {session.status === 'paused' && session.guidanceCanResume && (
            <button type="button" className="iqon-btn-primary min-h-11 justify-center" onClick={() => void onResume()} disabled={busy || !canExecute || snapshotStale}>
              <Play className="h-4 w-4" />
              {t('iosOrganize.resume')}
            </button>
          )}
          {!['completed', 'failed', 'cancelled'].includes(session.status) && (
            <button type="button" className="iqon-btn-secondary min-h-11 justify-center" onClick={() => void onCancel()}>
              <StopCircle className="h-4 w-4" />
              {t('iosOrganize.stop')}
            </button>
          )}
        </div>
        {['paused', 'failed', 'cancelled'].includes(session.status) && (
          <button type="button" className="iqon-btn-secondary min-h-11 w-full justify-center" onClick={() => void (mirrorMode === 'interaction' ? onExitInteraction() : onScan())} disabled={busy || (mirrorMode !== 'interaction' && !canScan)}>
            <RefreshCw className="h-4 w-4" />
            {t(mirrorMode === 'interaction' ? 'iosOrganize.interaction.returnScan' : 'iosOrganize.rescan')}
          </button>
        )}
      </>
    )
  }

  return (
    <>
      <div className="ios-verify-visual" data-passed={verificationPassed}>
        <div className="ios-verify-ring">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">{t('iosOrganize.verifyTitle')}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('iosOrganize.verifyDesc')}</p>
        </div>
      </div>
      <button type="button" className="iqon-btn-primary min-h-11 w-full justify-center" onClick={() => void onVerify()} disabled={busy || !canScan}>
        <ShieldCheck className="h-4 w-4" />
        {t('iosOrganize.verify')}
      </button>
      {verification && !verificationPassed && (
        <button type="button" className="iqon-btn-secondary min-h-11 w-full justify-center" onClick={() => void onScan()} disabled={busy || !canScan}>
          <RefreshCw className="h-4 w-4" />{t('iosOrganize.rescan')}
        </button>
      )}
      {verificationPassed && (
        <div className="flex items-center gap-2 rounded-2xl border border-iqon-green/25 bg-iqon-green/[0.07] p-3 text-xs font-bold text-iqon-green">
          <CheckCircle2 className="h-4 w-4" />
          {t('iosOrganize.verifyPassed')}
        </div>
      )}
    </>
  )
}
