import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { MaintenanceState } from '@/hooks/useMaintenanceRun'
import { Loader2, Square } from 'lucide-react'

export function MaintenanceRunStatus({ state, onCancel }: { state: MaintenanceState; onCancel: () => void }) {
  const { t } = useI18n()
  if (!state.run && !state.failure && !state.output) return null
  const statusKey = state.failure?.code === 'cancelled' ? 'maintenance.cancelled' : state.failure?.code === 'timeout' ? 'maintenance.timeout' : 'maintenance.failed'
  return (
    <div className="stow-panel my-4 space-y-3 p-4" role="status">
      {state.run && <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{t(state.cancelling ? 'maintenance.cancelling' : 'maintenance.running')} · {t(`maintenance.phase.${state.run.phase}`)}</p>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={state.cancelling}><Square className="mr-2 h-3 w-3" />{t('maintenance.cancel')}</Button>
      </div>}
      {state.run?.phase === 'execute' && <p className="text-xs text-muted-foreground">{t('maintenance.cancelHint')}</p>}
      {state.cancelError && <p className="break-words text-xs text-iqon-yellow">{t('maintenance.cancelFailed', { error: state.cancelError })}</p>}
      {state.failure && <p className="break-words text-xs text-iqon-yellow">{t(statusKey)}{state.failure.message ? ` · ${state.failure.message}` : ''}</p>}
      {state.output && <details><summary className="cursor-pointer text-xs font-semibold">{t('maintenance.logs')}</summary>
        {(state.outputTruncated || state.failure?.output_truncated) && <p className="mt-2 text-xs text-muted-foreground">{t('maintenance.truncated')}</p>}
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-hover p-3 text-xs">{state.output}</pre>
      </details>}
    </div>
  )
}
