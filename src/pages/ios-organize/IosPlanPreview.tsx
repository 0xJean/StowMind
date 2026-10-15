import { Play, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'
import type { IosLayoutPlan, IosLayoutSnapshot } from '@/lib/ios'
import { operationLabel, Warning } from './IosOrganizeComponents'

type Action = () => void | Promise<unknown>

export function IosPlanPreview({ plan, snapshot, busy, canExecute, canScan, hasSession,
  onExecute, onChangePlan, onScan, children,
}: {
  plan: IosLayoutPlan
  snapshot: IosLayoutSnapshot | null
  busy: boolean
  canExecute: boolean
  canScan: boolean
  hasSession: boolean
  onExecute: Action
  onChangePlan: Action
  onScan: Action
  children?: ReactNode
}) {
  const { t } = useI18n()
  const empty = plan.operations.length === 0
  return (
    <>
      <div className="rounded-2xl border border-iqon-border bg-iqon-row p-4">
        <p className="text-sm font-bold">{t(empty ? 'iosOrganize.preview.emptyTitle' : 'iosOrganize.previewTitle')}</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {empty ? t('iosOrganize.preview.emptyHelp') : t('iosOrganize.visual.operationSummary', { count: plan.operations.length })}
        </p>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t('iosOrganize.preview.supported')}</p>
      {!empty && (
        <ol className="max-h-72 space-y-2 overflow-auto pr-1" aria-label={t('iosOrganize.preview.allActions')} tabIndex={0}>
          {plan.operations.map((operation, index) => (
            <li key={`${operation.type}-${index}`} className="ios-operation-row">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-iqon-green/10 font-mono text-xs font-bold text-iqon-green">{index + 1}</span>
              <span className="text-xs leading-5 text-muted-foreground">{operationLabel(operation, snapshot, t)}</span>
            </li>
          ))}
        </ol>
      )}
      {plan.warnings.length > 0 && (
        <details className="rounded-xl border border-iqon-border p-3" open={empty}>
          <summary className="cursor-pointer text-xs font-bold">{t('iosOrganize.preview.notes', { count: plan.warnings.length })}</summary>
          <div className="mt-3 max-h-60 space-y-2 overflow-auto">
            {plan.warnings.map((warning, index) => <Warning key={index} text={warning} compact />)}
          </div>
        </details>
      )}
      {children}
      {!empty && (
        <button type="button" className="iqon-btn-primary min-h-11 w-full justify-center" onClick={() => void onExecute()} disabled={busy || !canExecute || hasSession}>
          <Play className="h-4 w-4" />{t('iosOrganize.execute')}
        </button>
      )}
      <button type="button" className="iqon-btn-secondary min-h-11 w-full justify-center" onClick={() => void onChangePlan()} disabled={busy}>
        {t('iosOrganize.visual.changePlan')}
      </button>
      {empty && (
        <button type="button" className="iqon-btn-secondary min-h-11 w-full justify-center" onClick={() => void onScan()} disabled={busy || !canScan}>
          <RefreshCw className="h-4 w-4" />{t('iosOrganize.rescan')}
        </button>
      )}
    </>
  )
}
