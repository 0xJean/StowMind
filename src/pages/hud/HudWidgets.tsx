import { Sparkline } from '@/components/Sparkline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { ComponentType } from 'react'

type HudAccent = 'emerald' | 'amber' | 'cyan' | 'blue' | 'orange' | 'rose'

export function HudChip({ value }: { value: string }) {
  return <Badge variant="outline" className="border-border/70 bg-surface-hover px-2 py-0 text-[10px] text-muted-foreground">{value}</Badge>
}

export function HudMetricTile({
  icon: Icon,
  title,
  badge,
  value,
  detail,
  sparkline,
  dualSparkline,
  progress,
  accent,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  badge?: string
  value: string
  detail: string
  sparkline?: number[]
  dualSparkline?: { a: number[]; b: number[] }
  progress?: number
  accent: HudAccent
}) {
  const accentClass: Record<HudAccent, { icon: string; pill: string; stroke: string; bar: string }> = {
    emerald: {
      icon: 'text-clean-green',
      pill: 'bg-clean-green/15 text-clean-green',
      stroke: 'stroke-clean-green',
      bar: 'bg-clean-green',
    },
    amber: {
      icon: 'text-clean-yellow',
      pill: 'bg-clean-yellow/15 text-yellow-600 dark:text-clean-yellow',
      stroke: 'stroke-clean-yellow',
      bar: 'bg-clean-yellow',
    },
    cyan: {
      icon: 'text-clean-cyan',
      pill: 'bg-clean-cyan/15 text-clean-cyan',
      stroke: 'stroke-clean-cyan',
      bar: 'bg-clean-cyan',
    },
    blue: {
      icon: 'text-primary',
      pill: 'bg-primary/15 text-primary',
      stroke: 'stroke-primary',
      bar: 'bg-primary',
    },
    orange: {
      icon: 'text-orange-500 dark:text-orange-300',
      pill: 'bg-orange-500/15 text-orange-600 dark:text-orange-300',
      stroke: 'stroke-orange-500 dark:stroke-orange-300',
      bar: 'bg-orange-500',
    },
    rose: {
      icon: 'text-clean-red',
      pill: 'bg-clean-red/15 text-clean-red',
      stroke: 'stroke-clean-red',
      bar: 'bg-clean-red',
    },
  }
  const classes = accentClass[accent]

  return (
    <div className="min-h-[108px] rounded-xl border border-border/60 bg-surface-hover/70 p-3 shadow-soft">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 ${classes.icon}`} />
          {title}
        </p>
        {badge && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${classes.pill}`}>{badge}</span>}
      </div>
      <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>
      {sparkline && <Sparkline values={sparkline} className="mt-1 h-7" colorClassName={classes.stroke} />}
      {dualSparkline && <DualSparkline a={dualSparkline.a} b={dualSparkline.b} />}
      {typeof progress === 'number' && (
        <div className="mt-3 h-2 rounded-full bg-muted">
          <div className={`h-2 rounded-full ${classes.bar}`} style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} />
        </div>
      )}
    </div>
  )
}

function DualSparkline({ a, b }: { a: number[]; b: number[] }) {
  return (
    <div className="mt-1 space-y-0.5">
      <Sparkline values={a} className="h-4" colorClassName="stroke-clean-green" />
      <Sparkline values={b} className="h-4" colorClassName="stroke-clean-cyan" />
    </div>
  )
}

export function HudRoundStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[4.75rem] rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-2 text-right">
      <p className="text-[10px] font-semibold leading-none text-primary">{label}</p>
      <p className="mt-1 whitespace-nowrap text-xs font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

export function HudWatchStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-2">
      <p className="truncate text-base font-bold tabular-nums text-foreground">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

export function TogglePanel({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border bg-surface-hover p-4">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function MetricToggle({
  label,
  checked,
  disabled,
  onClick,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" variant={checked ? 'default' : 'outline'} size="sm" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  )
}
