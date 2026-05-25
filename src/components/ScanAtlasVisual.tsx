import { cn } from '@/lib/utils'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

export type ScanAtlasVisualState = 'ready' | 'loading' | 'idle' | 'complete' | 'error'

interface ScanAtlasVisualProps {
  state?: ScanAtlasVisualState
  className?: string
  ariaLabel?: string
}

export function ScanAtlasVisual({
  state = 'ready',
  className,
  ariaLabel,
}: ScanAtlasVisualProps) {
  const showBadge = state === 'complete' || state === 'error'

  return (
    <div
      className={cn(
        'clean-scan-atlas',
        state === 'loading' && 'clean-scan-atlas-active',
        state === 'idle' && 'clean-scan-atlas-idle',
        state === 'complete' && 'clean-scan-atlas-complete',
        state === 'error' && 'clean-scan-atlas-error',
        className
      )}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      <div className="clean-scan-atlas-sweep" />
      <div className="clean-scan-atlas-core">
        <img src="/icon.svg" alt="" className="clean-scan-atlas-logo" draggable={false} />
      </div>
      {showBadge && (
        <span className={cn('clean-scan-atlas-badge', state === 'error' && 'clean-scan-atlas-badge-error')}>
          {state === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
      )}
    </div>
  )
}
