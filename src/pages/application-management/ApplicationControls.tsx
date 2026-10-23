import { cn } from '@/lib/utils'
import { AppWindow } from 'lucide-react'

export function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof AppWindow
  label: string
  value: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div
      className={cn(
        'stow-panel flex items-center justify-between gap-4 p-5',
        tone === 'warning' && 'border-yellow-400/25 bg-yellow-500/10'
      )}
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-normal text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold tracking-normal">{value}</p>
      </div>
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary', tone === 'warning' && 'bg-yellow-500/15 text-yellow-600')}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  )
}

export function ModeButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl px-4 py-2 text-sm font-bold transition-colors',
        active ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'
      )}
    >
      {label}
      <span className="ml-2 font-mono text-xs text-muted-foreground">{count}</span>
    </button>
  )
}

export function SortButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
