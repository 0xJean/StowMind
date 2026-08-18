import { AlertTriangle, Bot, CheckCircle2, Loader2, Settings2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { aiProviderLabel, type AiSetupIssue } from '@/lib/aiProvider'
import type { AIProvider } from '@/stores/app'
import type { AiActivationStatus } from '@/hooks/useAiActivation'

interface AiSetupGuideProps {
  provider: AIProvider
  status: AiActivationStatus
  issue: AiSetupIssue | null
  onOpenSettings: () => void
}

export function AiSetupGuide({
  provider,
  status,
  issue,
  onOpenSettings,
}: AiSetupGuideProps) {
  const { t } = useI18n()
  const blocked = status === 'needs-setup'
  const ready = status === 'ready'
  const checking = status === 'checking'
  const issueText = issue ? issueLabel(issue, t) : null

  return (
    <div className={`rounded-xl border p-4 ${
      blocked
        ? 'border-iqon-yellow/40 bg-iqon-yellow/5'
        : ready
          ? 'border-iqon-green/35 bg-iqon-green/5'
          : 'border-iqon-border bg-iqon-row'
    }`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground">
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin text-iqon-cyan" />
            ) : ready ? (
              <CheckCircle2 className="h-4 w-4 text-iqon-green" />
            ) : blocked ? (
              <AlertTriangle className="h-4 w-4 text-iqon-yellow" />
            ) : (
              <Bot className="h-4 w-4 text-muted-foreground" />
            )}
            {t('aiGuide.title')}
          </div>
          <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-3">
            <FlowStep index="1" label={t('aiGuide.step.enable')} value={statusLabel(status, t)} active={status !== 'off'} />
            <FlowStep index="2" label={t('aiGuide.step.provider')} value={aiProviderLabel(provider)} active={status !== 'off'} />
            <FlowStep index="3" label={t('aiGuide.step.ready')} value={ready ? t('aiGuide.ready') : checking ? t('aiGuide.checking') : t('aiGuide.pending')} active={ready} />
          </div>
          <p className={`mt-3 text-[11px] leading-5 ${blocked ? 'text-iqon-yellow' : 'text-muted-foreground'}`}>
            {blocked
              ? issueText
              : ready
                ? t('aiGuide.readyDesc', { provider: aiProviderLabel(provider) })
                : checking
                  ? t('aiGuide.checkingDesc', { provider: aiProviderLabel(provider) })
                  : t('aiGuide.offDesc')}
          </p>
        </div>
        {blocked && (
          <button type="button" className="iqon-btn-secondary shrink-0" onClick={onOpenSettings}>
            <Settings2 className="h-3.5 w-3.5" />
            {t('aiGuide.openSettings')}
          </button>
        )}
      </div>
      {blocked && (
        <p className="mt-3 border-t border-iqon-yellow/20 pt-3 text-[10px] text-muted-foreground">
          {t('aiGuide.ruleFallback')}
        </p>
      )}
    </div>
  )
}

function FlowStep({
  index,
  label,
  value,
  active,
}: {
  index: string
  label: string
  value: string
  active: boolean
}) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${active ? 'border-iqon-cyan/30 bg-iqon-cyan/5' : 'border-iqon-border bg-iqon-card'}`}>
      <div className="flex items-center gap-1.5 font-bold uppercase tracking-widest text-muted-foreground">
        <span className={active ? 'text-iqon-cyan' : ''}>{index}</span>
        {label}
      </div>
      <div className="mt-1 truncate font-bold text-foreground">{value}</div>
    </div>
  )
}

function statusLabel(
  status: AiActivationStatus,
  t: ReturnType<typeof useI18n>['t'],
) {
  if (status === 'ready') return t('aiGuide.enabled')
  if (status === 'checking') return t('aiGuide.checking')
  if (status === 'needs-setup') return t('aiGuide.blocked')
  return t('aiGuide.disabled')
}

function issueLabel(
  issue: AiSetupIssue,
  t: ReturnType<typeof useI18n>['t'],
) {
  switch (issue) {
    case 'missingApiKey':
      return t('aiGuide.issue.missingApiKey')
    case 'missingHost':
      return t('aiGuide.issue.missingHost')
    case 'missingModel':
      return t('aiGuide.issue.missingModel')
    case 'unavailable':
      return t('aiGuide.issue.unavailable')
    case 'checkFailed':
      return t('aiGuide.issue.checkFailed')
  }
}
