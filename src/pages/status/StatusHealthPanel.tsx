import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { DIAGNOSTIC_VARIANT, clampPercent } from './utils'
import { SectionCard } from './StatusWidgets'
import type { HealthInsight } from './healthInsights'

type Translate = (key: any, vars?: Record<string, string | number>) => string

export function StatusHealthPanel({
  score,
  message,
  insights,
  t,
}: {
  score: number | null
  message: string
  insights: HealthInsight[]
  t: Translate
}) {
  return (
    <SectionCard title={t('status.health.title')} description={t('status.health.desc')}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_1fr]">
        <div className="iqon-row relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-iqon-green opacity-[0.18] blur-[40px]" />
          <p className="iqon-eyebrow relative">{t('status.metric.health')}</p>
          <div className="relative mt-2 flex items-end gap-2">
            <span className="text-4xl font-bold tabular-nums">{score ?? '-'}</span>
            <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
          </div>
          <p className="relative mt-2 min-h-[2rem] text-xs text-muted-foreground">{message}</p>
          <Progress value={clampPercent(score ?? 0)} className="relative mt-4" />
          <p className="relative mt-3 text-[10px] text-muted-foreground">{t('status.health.source')}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {insights.map((insight) => (
            <div key={insight.id} className="iqon-row p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-bold text-foreground">{insight.title}</p>
                <Badge variant={DIAGNOSTIC_VARIANT[insight.level]} className="shrink-0">
                  {t(`status.level.${insight.level}`)}
                </Badge>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">{insight.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  )
}
