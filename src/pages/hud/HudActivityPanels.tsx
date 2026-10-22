import { useI18n } from '@/i18n'
import type { CleanupActivitySummary } from '@/lib/stowmind-supplements/cleanupActivity'
import { formatFileSize } from '@/lib/utils'
import { Trash2 } from 'lucide-react'
import type { MoleProcess } from '../status/types'
import { formatPercent } from '../status/utils'
import { HudWatchStat } from './HudWidgets'

export function HudProcessSummary({ processes }: { processes: MoleProcess[] }) {
  const { t } = useI18n()
  return (
    <div className="iqon-row p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
        <span>{t('hud.processTitle')}</span>
        <span className="grid grid-cols-2 gap-5 normal-case tracking-normal"><span>CPU</span><span>{t('hud.field.memory')}</span></span>
      </div>
      <div className="space-y-2">
        {processes.length ? processes.map((process) => (
          <div key={process.pid} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
            <span className="truncate font-semibold text-foreground">{process.name}</span>
            <span className="tabular-nums text-muted-foreground">{formatPercent(process.cpu)}</span>
            <span className="tabular-nums text-muted-foreground">{formatPercent(process.memory)}</span>
          </div>
        )) : <p className="text-xs text-muted-foreground">{t('hud.emptyProcess')}</p>}
      </div>
    </div>
  )
}

export function HudCleanupSummary({ activity, trashSize }: { activity: CleanupActivitySummary; trashSize: number }) {
  const { t } = useI18n()
  return (
    <div className="rounded-xl border border-clean-green/20 bg-clean-green/10 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-clean-green"><Trash2 className="h-3.5 w-3.5" />{t('hud.cleanWatch')}</p>
        <span className="text-sm font-bold tabular-nums text-foreground">{formatFileSize(trashSize)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <HudWatchStat label={t('hud.cleanWatch.cleaned')} value={formatFileSize(activity.totalFreed)} />
        <HudWatchStat label={t('hud.cleanWatch.scans')} value={String(activity.executedCount + activity.previewCount)} />
        <HudWatchStat label={t('hud.cleanWatch.optimized')} value={String(activity.optimizedCount)} />
      </div>
      {activity.observedCacheReduction > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t('hud.cacheObserved', { size: formatFileSize(activity.observedCacheReduction) })}</p>}
      <p className="mt-2 truncate text-[11px] text-muted-foreground">
        {activity.latest ? t('hud.cleanWatch.latest', { target: activity.latest.directory }) : t('hud.cleanWatch.empty')}
      </p>
    </div>
  )
}
