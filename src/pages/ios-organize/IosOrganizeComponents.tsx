import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  LockKeyhole,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import type { RefObject } from 'react'
import { useI18n } from '@/i18n'
import type {
  IosDeviceCapabilities,
  IosLayoutSnapshot,
  IosOperation,
} from '@/lib/ios'
import type { IosMirrorPreviewState } from './useIosMirrorPreview'

export type IosOrganizeStep = 'connect' | 'scan' | 'plan' | 'preview' | 'execute' | 'verify'

type Translate = ReturnType<typeof useI18n>['t']

export function IosOrganizerHeader({
  busy,
  onOpenMirroring,
  onRefresh,
}: {
  busy: boolean
  onOpenMirroring: () => void
  onRefresh: () => void
}) {
  const { t } = useI18n()
  return (
    <header className="ios-organizer-header">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="iqon-eyebrow">{t('eyebrow.system')}</p>
          <span className="ios-safety-pill">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('iosOrganize.noDeleteTitle')}
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-[-0.04em]">{t('iosOrganize.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t('iosOrganize.subtitle')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="iqon-btn-secondary min-h-11" onClick={onOpenMirroring} disabled={busy}>
          <ExternalLink className="h-4 w-4" />
          {t('iosOrganize.openMirroring')}
        </button>
        <button type="button" className="iqon-btn-secondary min-h-11" onClick={onRefresh} disabled={busy} aria-label={t('iosOrganize.refresh')}>
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          {t('iosOrganize.refresh')}
        </button>
      </div>
    </header>
  )
}

export function WorkflowRail({
  steps,
  current,
}: {
  steps: { id: IosOrganizeStep; label: string; description: string }[]
  current: IosOrganizeStep
}) {
  const currentIndex = steps.findIndex((step) => step.id === current)
  return (
    <nav className="ios-workflow-rail" aria-label="iPhone organization workflow">
      {steps.map((step, index) => {
        const active = step.id === current
        const done = currentIndex > index
        return (
          <div
            key={step.id}
            className="ios-workflow-step"
            data-active={active}
            data-done={done}
            title={step.description}
          >
            <span className="ios-workflow-marker">
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="ios-workflow-label">{step.label}</span>
          </div>
        )
      })}
    </nav>
  )
}

export function Capability({
  label,
  ok,
  ready,
  pending,
}: {
  label: string
  ok: boolean
  ready: string
  pending: string
}) {
  return (
    <div className="ios-capability" data-ready={ok}>
      <span className="ios-capability-dot" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{label}</span>
      <span className="text-[10px] font-bold">{ok ? ready : pending}</span>
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ios-stat">
      <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 block font-mono text-lg font-bold tracking-tight text-foreground">
        {value}
      </span>
    </div>
  )
}

export function Warning({
  text,
  compact = false,
  large = false,
  actionLabel,
  onAction,
}: {
  text: string
  compact?: boolean
  large?: boolean
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div
      className={`${
        large
          ? 'rounded-2xl p-4'
          : compact
            ? 'rounded-xl px-3 py-2.5'
            : 'rounded-2xl p-3.5'
      } border border-amber-400/30 bg-amber-400/[0.07] text-xs leading-5 text-amber-700 dark:text-amber-200`}
      role="alert"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <AlertTriangle className="mr-2 inline h-3.5 w-3.5" />
          {text}
        </span>
        {actionLabel && onAction && (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold transition-colors hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function ProgressBar({
  label,
  current,
  total,
}: {
  label: string
  current: number
  total: number
}) {
  const width = total ? Math.min(100, (current / total) * 100) : 0
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <span className="font-mono text-[10px] font-bold text-foreground">
          {Math.round(width)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-iqon-row">
        <div
          className="h-full rounded-full bg-iqon-green transition-[width] duration-300"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

export function IosDeviceStage({
  previewRef,
  previewState,
  previewError,
  snapshot,
  capabilities,
  onRefreshPreview,
  onEnterInteraction,
}: {
  previewRef: RefObject<HTMLDivElement>
  previewState: IosMirrorPreviewState
  previewError: string | null
  snapshot: IosLayoutSnapshot | null
  capabilities: IosDeviceCapabilities | null
  onRefreshPreview: () => void
  onEnterInteraction: () => void
}) {
  const { t } = useI18n()
  const connectionState = capabilities?.mirrorConnectionState ?? 'unavailable'
  const contentReady = capabilities?.mirrorContentReady ?? false
  const connected = Boolean(
    capabilities?.mirrorRunning
      && contentReady
      && previewState === 'live'
  )
  const canPreview = Boolean(
    capabilities?.mirrorRunning
      && capabilities.helperAvailable
      && capabilities.screenRecordingGranted
  )
  const statusLabel = connectionState === 'paused'
    ? t('iosOrganize.visual.previewPaused')
    : connectionState === 'blocked'
      ? t('iosOrganize.visual.previewBlocked')
      : previewState === 'live'
        ? t('iosOrganize.visual.nativePreviewLive')
        : t('iosOrganize.visual.nativePreviewWaiting')
  const confidence = snapshot ? `${Math.round(snapshot.confidence * 100)}%` : '--'

  return (
    <section className="ios-device-stage">
      <div className="ios-stage-glow" aria-hidden="true" />
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
            {t('iosOrganize.visual.liveCanvas')}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="ios-live-dot"
              data-live={connected}
              data-state={connectionState}
            />
            <p className="text-sm font-bold text-white">{statusLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="ios-stage-control"
            onClick={onRefreshPreview}
            disabled={!canPreview}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${previewState === 'starting' ? 'animate-spin' : ''}`} />
            {t('iosOrganize.visual.refreshPreview')}
          </button>
          <button
            type="button"
            className="ios-stage-control"
            onClick={onEnterInteraction}
            disabled={!capabilities?.mirrorRunning}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            {t('iosOrganize.interaction.enter')}
          </button>
        </div>
      </header>

      <div className="ios-device-display">
        <div className="ios-orbit ios-orbit-one" aria-hidden="true" />
        <div className="ios-orbit ios-orbit-two" aria-hidden="true" />

        <div
          ref={previewRef}
          className="ios-native-mirror-preview"
          data-state={previewState}
          aria-label={t('iosOrganize.visual.nativePreview')}
        >
          <div className="ios-native-mirror-placeholder">
            <div className="ios-placeholder-icon">
              {capabilities?.mirrorRunning ? (
                <LockKeyhole className="h-7 w-7" />
              ) : (
                <Smartphone className="h-7 w-7" />
              )}
            </div>
            <p className="mt-4 text-sm font-bold text-white">
              {!capabilities?.mirrorRunning
                ? t('iosOrganize.visual.openToPreview')
                : !capabilities.screenRecordingGranted
                  ? t('iosOrganize.visual.previewNeedsRecording')
                  : connected
                    ? t('iosOrganize.visual.nativePreviewReady')
                    : t('iosOrganize.visual.lockToPreview')}
            </p>
            <p className="mt-1 max-w-[210px] text-center text-[10px] leading-4 text-white/45">
              {t('iosOrganize.visual.nativePreviewHelp')}
            </p>
          </div>
        </div>

        <div className="ios-stage-float ios-stage-float-left">
          <span>{t('iosOrganize.stat.apps')}</span>
          <strong>{snapshot ? snapshot.apps.length : '--'}</strong>
        </div>
        <div className="ios-stage-float ios-stage-float-right">
          <span>{t('iosOrganize.stat.confidence')}</span>
          <strong>{confidence}</strong>
        </div>
      </div>

      <div className="relative z-10 grid gap-2 sm:grid-cols-3">
        <div className="ios-privacy-chip">
          <LockKeyhole className="h-3.5 w-3.5" />
          <span>{t('iosOrganize.visual.gpuDirectPreview')}</span>
        </div>
        <div className="ios-privacy-chip">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>{t('iosOrganize.visual.noScreenshotAi')}</span>
        </div>
        <div className="ios-privacy-chip">
          <Check className="h-3.5 w-3.5" />
          <span>{t('iosOrganize.visual.zeroDelete')}</span>
        </div>
      </div>

      {previewError && (
        <p className="relative z-10 mt-3 text-center text-[10px] leading-4 text-amber-200/80">
          {previewError}
        </p>
      )}
    </section>
  )
}

export function IosSnapshotOverview({
  snapshot,
  snapshotStale,
  busy,
  canScan,
  onScan,
}: {
  snapshot: IosLayoutSnapshot | null
  snapshotStale: boolean
  busy: boolean
  canScan: boolean
  onScan: () => void
}) {
  const { t } = useI18n()
  const counts = new Map<string, number>()
  for (const app of snapshot?.apps ?? []) {
    counts.set(app.category, (counts.get(app.category) ?? 0) + 1)
  }
  const categoryCounts = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)

  return (
    <section className="ios-insight-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-foreground">{t('iosOrganize.visual.snapshotTitle')}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {snapshotStale
              ? t('iosOrganize.visual.snapshotStale')
              : snapshot
                ? t('iosOrganize.visual.snapshotReady')
                : t('iosOrganize.visual.snapshotEmpty')}
          </p>
        </div>
        {snapshot && (
          <button type="button" className="ios-inline-action" onClick={onScan} disabled={busy || !canScan}>
            {t('iosOrganize.rescan')}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label={t('iosOrganize.stat.apps')} value={snapshot ? String(snapshot.apps.length) : '--'} />
        <Stat label={t('iosOrganize.stat.confidence')} value={snapshot ? `${Math.round(snapshot.confidence * 100)}%` : '--'} />
        <Stat label={t('iosOrganize.stat.pages')} value={snapshot ? String(snapshot.pages.length) : '--'} />
        <Stat label={t('iosOrganize.stat.scope')} value={snapshot ? (snapshot.inventoryComplete ? t('iosOrganize.scope.complete') : snapshot.scanScope === 'homeScreenPages' ? t('iosOrganize.scope.homePages') : snapshot.scanScope === 'partialHomeScreenPages' ? t('iosOrganize.scope.partialPages') : t('iosOrganize.scope.visible')) : '--'} />
      </div>

      {categoryCounts.length > 0 && (
        <div className="mt-4 border-t border-iqon-border pt-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            {t('iosOrganize.visual.categoryOverview')}
          </p>
          <div className="space-y-2.5">
            {categoryCounts.map(([category, count]) => (
              <div key={category} className="grid grid-cols-[64px_1fr_28px] items-center gap-2">
                <span className="truncate text-[10px] font-bold text-foreground">{category}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-iqon-row">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-iqon-green to-iqon-cyan"
                    style={{ width: `${Math.max(8, (count / (snapshot?.apps.length || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-right font-mono text-[10px] text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {snapshot?.warnings.map((warning) => (
        <div key={warning} className="mt-3">
          <Warning text={warning} compact />
        </div>
      ))}
    </section>
  )
}

function operationAppName(
  operation: Extract<IosOperation, { type: 'moveApp' | 'moveToDock' }>,
  snapshot: IosLayoutSnapshot | null,
  t: Translate
) {
  const appId = operation.appId ?? (operation as { app_id?: string }).app_id
  if (!appId) return t('iosOrganize.operation.unknownApp')
  return snapshot?.apps.find((app) => app.id === appId)?.name ?? appId
}

export function operationLabel(
  operation: IosOperation,
  snapshot: IosLayoutSnapshot | null,
  t: Translate
) {
  switch (operation.type) {
    case 'moveApp':
      return t('iosOrganize.operation.move', {
        app: operationAppName(operation, snapshot, t),
      })
    case 'createFolder':
      return t('iosOrganize.operation.folder', {
        name: operation.name,
        count: operation.appIds.length,
      })
    case 'renameFolder':
      return t('iosOrganize.operation.rename', { from: operation.from, to: operation.to })
    case 'moveToDock':
      return t('iosOrganize.operation.dock', {
        app: operationAppName(operation, snapshot, t),
      })
  }
}
