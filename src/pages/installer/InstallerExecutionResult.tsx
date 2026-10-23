import { useI18n } from '@/i18n'
import type { MoleInstallerExecuteOutcome } from './types'

export function InstallerExecutionResult({ result }: { result: MoleInstallerExecuteOutcome }) {
  const { t } = useI18n()
  const message = installerResultMessage(result, t)
  return (
    <div role="status" className="iqon-row w-full space-y-2 p-4 text-left">
      <h3 className="text-sm font-bold">{t('installer.resultTitle')}</h3>
      <p className="text-xs text-muted-foreground">{message}</p>
      {result.raw_output && <details>
        <summary className="cursor-pointer text-xs font-semibold">{t('installer.resultDetails')}</summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/50 p-3 text-xs">{result.raw_output}</pre>
      </details>}
    </div>
  )
}

export function installerResultMessage(result: MoleInstallerExecuteOutcome, t: ReturnType<typeof useI18n>['t']): string {
  const count = result.item_count ?? t('clean.summary.unknown')
  if (result.status === 'success' && result.item_count !== null && result.total_size !== null) return t('installer.executeSuccess', { count })
  if (result.status === 'partial') return t('installer.resultPartial', { count, failed: result.failed_count ?? t('clean.summary.unknown') })
  return t(result.status === 'failed' ? 'installer.resultFailed' : 'installer.resultUnknown')
}
