import { Progress } from '@/components/ui/progress'
import { formatPercent, clampPercent } from './utils'
import type { ComponentType, ReactNode } from 'react'
import type { MetricVariant } from './types'

const VARIANT_TONE: Record<MetricVariant, { text: string; glow: string; mesh: string }> = {
  default: { text: 'text-iqon-cyan', glow: 'bg-iqon-cyan', mesh: 'text-iqon-cyan/40' },
  success: { text: 'text-iqon-green', glow: 'bg-iqon-green', mesh: 'text-iqon-green/40' },
  warning: { text: 'text-iqon-yellow', glow: 'bg-iqon-yellow', mesh: 'text-iqon-yellow/40' },
  destructive: { text: 'text-iqon-red', glow: 'bg-iqon-red', mesh: 'text-iqon-red/40' },
}

export function MetricCard({
  icon: Icon,
  title,
  value,
  detail,
  progress,
  variant = 'default',
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  value: string
  detail: string
  progress?: number
  variant?: MetricVariant
}) {
  const tone = VARIANT_TONE[variant]
  return (
    <div className="iqon-card iqon-card-hover relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className={`absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-[0.18] blur-[40px] ${tone.glow}`} />
        <div className={`iqon-mesh-soft absolute inset-0 ${tone.mesh}`} />
      </div>
      <div className="relative z-10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="iqon-eyebrow">{title}</p>
            <p className="mt-1 break-words text-2xl font-bold tabular-nums">{value}</p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-iqon-border bg-iqon-row">
            <Icon className={`h-5 w-5 ${tone.text}`} />
          </span>
        </div>
        <p className="break-words text-xs font-medium text-muted-foreground">{detail}</p>
        {typeof progress === 'number' && (
          <div className="space-y-1.5">
            <Progress value={clampPercent(progress)} />
            <div className="text-right text-[11px] tabular-nums text-muted-foreground">{formatPercent(progress)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl px-3 py-2 transition-colors hover:bg-iqon-row">
      <span className="iqon-eyebrow shrink-0">{label}</span>
      <span className="break-all text-right text-sm font-bold">{value}</span>
    </div>
  )
}

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="iqon-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
