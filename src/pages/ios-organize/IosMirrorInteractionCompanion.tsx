import { ArrowLeft, MousePointer2, ShieldCheck, Smartphone } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'

export function IosMirrorInteractionCompanion({
  step,
  stepNumber,
  totalSteps,
  error,
  onExit,
  children,
}: {
  step: { label: string; description: string }
  stepNumber: number
  totalSteps: number
  error: ReactNode
  onExit: () => void
  children: ReactNode
}) {
  const { t } = useI18n()

  return (
    <div className="ios-interaction-companion">
      <header className="ios-interaction-header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ios-interaction-icon">
            <Smartphone className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-iqon-green">
              {t('iosOrganize.interaction.eyebrow')}
            </p>
            <h1 className="truncate text-lg font-bold">
              {t('iosOrganize.interaction.title')}
            </h1>
          </div>
        </div>
        <button type="button" className="ios-stage-control" onClick={onExit}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('iosOrganize.interaction.exit')}
        </button>
      </header>

      <div className="ios-interaction-notice">
        <MousePointer2 className="mt-0.5 h-4 w-4 shrink-0 text-iqon-green" />
        <p>{t('iosOrganize.interaction.help')}</p>
      </div>

      <section className="ios-control-deck">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-iqon-green">
              {t('iosOrganize.visual.stepCounter', {
                current: stepNumber,
                total: totalSteps,
              })}
            </p>
            <h2 className="mt-2 text-lg font-bold">{step.label}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {step.description}
            </p>
          </div>
          <span className="ios-interaction-step">{stepNumber}</span>
        </div>

        {error}
        <div className="ios-current-action">{children}</div>
        <div className="ios-safety-footer">
          <ShieldCheck className="h-4 w-4 shrink-0 text-iqon-green" />
          <p className="text-[10px] leading-4 text-muted-foreground">
            {t('iosOrganize.noDeleteDesc')}
          </p>
        </div>
      </section>
    </div>
  )
}
