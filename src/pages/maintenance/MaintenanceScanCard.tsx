import { ScanAtlasVisual, type ScanAtlasVisualState } from '@/components/ScanAtlasVisual'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { AlertCircle, Loader2, type LucideIcon } from 'lucide-react'
import { type ReactNode } from 'react'
import { formatElapsed } from '../clean/CleanScanStatusPanel'

interface MaintenanceScanCardProps {
  actionIcon: LucideIcon
  actionLabel: string
  description: string
  elapsedLabel: string
  idleStatus: string
  loading: boolean
  loadingDescription: string
  loadingStatus: string
  loadingTitle: string
  onAction: () => void
  title: string
  actionDisabled?: boolean
  children?: ReactNode
  completeDescription?: string
  completeTitle?: string
  errorMessage?: string | null
  fullScreen?: boolean
}

export function MaintenanceScanCard({
  actionIcon: ActionIcon,
  actionLabel,
  description,
  elapsedLabel,
  idleStatus,
  loading,
  loadingDescription,
  loadingStatus,
  loadingTitle,
  onAction,
  title,
  actionDisabled = false,
  children,
  completeDescription,
  completeTitle,
  errorMessage,
  fullScreen = false,
}: MaintenanceScanCardProps) {
  const hasCompleteState = Boolean(completeTitle)
  const visualState: ScanAtlasVisualState = loading
    ? 'loading'
    : errorMessage
      ? 'error'
      : hasCompleteState
        ? 'complete'
        : 'ready'

  return (
    <Card className={fullScreen ? 'w-full border-0 bg-transparent shadow-none' : undefined}>
      <CardContent className={`flex flex-col items-center justify-center gap-5 p-8 text-center ${
        fullScreen ? 'min-h-[calc(100vh-4rem)]' : 'min-h-[34rem]'
      }`}>
        <ScanAtlasVisual state={visualState} ariaLabel={title} />

        <div className="space-y-2">
          <CardTitle className="text-3xl">
            {loading ? loadingTitle : errorMessage ? title : completeTitle ?? title}
          </CardTitle>
          <CardDescription className="mx-auto max-w-xl">
            {loading ? loadingDescription : errorMessage ?? completeDescription ?? description}
          </CardDescription>
        </div>

        {(loading || !hasCompleteState || errorMessage) && (
          <MaintenanceStatusPanel
            elapsedLabel={elapsedLabel}
            errorMessage={errorMessage}
            idleStatus={idleStatus}
            loading={loading}
            loadingStatus={loadingStatus}
            title={title}
          />
        )}

        {children && <div className="w-full max-w-2xl">{children}</div>}

        {!loading && (
          <Button
            type="button"
            className="mt-1 w-full max-w-xs"
            onClick={onAction}
            disabled={actionDisabled}
          >
            <ActionIcon className="mr-2 h-4 w-4" />
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function MaintenanceStatusPanel({
  elapsedLabel,
  errorMessage,
  idleStatus,
  loading,
  loadingStatus,
  title,
}: {
  elapsedLabel: string
  errorMessage?: string | null
  idleStatus: string
  loading: boolean
  loadingStatus: string
  title: string
}) {
  const statusLabel = errorMessage ? title : loading ? loadingStatus : idleStatus

  return (
    <div className="iqon-row w-full max-w-2xl p-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-2 font-bold text-foreground">
          {errorMessage ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-iqon-red" />
          ) : loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-iqon-green" />
          ) : (
            <span className="iqon-dot iqon-dot-green shrink-0" />
          )}
          <span className="truncate">{statusLabel}</span>
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{elapsedLabel}</span>
      </div>

      {loading && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-iqon-border">
          <div className="stow-indeterminate-bar h-full w-1/3 rounded-full bg-iqon-green" />
        </div>
      )}

      {errorMessage && (
        <p className="mt-3 break-words text-[11px] leading-relaxed text-iqon-red">{errorMessage}</p>
      )}
    </div>
  )
}

export function formatMaintenanceElapsed(ms: number) {
  return formatElapsed(ms)
}
