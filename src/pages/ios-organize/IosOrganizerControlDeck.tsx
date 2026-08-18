import { ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'
import type { IosLayoutSnapshot } from '@/lib/ios'
import { IosSnapshotOverview, Warning } from './IosOrganizeComponents'

export function IosOrganizerControlDeck({
  step,
  stepNumber,
  totalSteps,
  warning,
  snapshot,
  snapshotStale,
  busy,
  canScan,
  onScan,
  children,
}: {
  step: { label: string; description: string }
  stepNumber: number
  totalSteps: number
  warning: string | null
  snapshot: IosLayoutSnapshot | null
  snapshotStale: boolean
  busy: boolean
  canScan: boolean
  onScan: () => void
  children: ReactNode
}) {
  const { t } = useI18n()

  return (
    <aside className="space-y-4">
      <section className="ios-control-deck">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-iqon-green">
              {t('iosOrganize.visual.stepCounter', {
                current: stepNumber,
                total: totalSteps,
              })}
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-foreground">
              {step.label}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {step.description}
            </p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-iqon-green/20 bg-iqon-green/[0.07] font-mono text-sm font-bold text-iqon-green">
            {stepNumber}
          </span>
        </div>

        {warning && <Warning text={warning} />}
        <div className="ios-current-action">{children}</div>
        <div className="ios-safety-footer">
          <ShieldCheck className="h-4 w-4 shrink-0 text-iqon-green" />
          <p className="text-[10px] leading-4 text-muted-foreground">
            {t('iosOrganize.noDeleteDesc')}
          </p>
        </div>
      </section>

      <IosSnapshotOverview
        snapshot={snapshot}
        snapshotStale={snapshotStale}
        busy={busy}
        canScan={canScan}
        onScan={onScan}
      />
    </aside>
  )
}
