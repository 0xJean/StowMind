import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { TerminalPanel } from '@/components/TerminalPanel'
import { useI18n } from '@/i18n'
import type { MoleStatus } from '@/stores/mole'
import { ArrowLeft, Loader2, Terminal } from 'lucide-react'
import { useState } from 'react'
import { MoleInstallGuide } from '../mole/MoleInstallGuide'

type SetupView = 'guide' | 'terminal'

interface MoleSetupPageProps {
  status: MoleStatus | null
  checking: boolean
  onRecheck: () => Promise<void> | void
  onSkip: () => void
}

export function MoleSetupPage({ status, checking, onRecheck, onSkip }: MoleSetupPageProps) {
  const { t } = useI18n()
  const [view, setView] = useState<SetupView>('guide')
  const [installCommand, setInstallCommand] = useState('')

  const finishTerminal = () => {
    setView('guide')
    void onRecheck()
  }

  if (view === 'terminal') {
    return (
      <div className="flex min-h-full w-full flex-col p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="stow-icon-box">
              <Terminal className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold">{t('moleSetup.installProgressTitle')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('moleSetup.installProgressDesc')}</p>
            </div>
          </div>
          <Button variant="outline" onClick={finishTerminal}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('moleSetup.finishInstall')}
          </Button>
        </div>

        <Card className="flex min-h-[34rem] flex-1 flex-col overflow-hidden">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 bg-surface-hover/70 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <span className="truncate text-xs font-semibold text-muted-foreground">
                {t('moleSetup.installing')}
              </span>
            </div>
            <Badge variant="success">{t('moleSetup.running')}</Badge>
          </div>
          <div className="min-h-0 flex-1">
            <TerminalPanel command={installCommand} onClose={finishTerminal} />
          </div>
        </Card>
      </div>
    )
  }

  if (checking && !status) {
    return (
      <div className="flex min-h-full w-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>{t('moleSetup.checking')}</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-full w-full items-center justify-center p-4 md:p-6">
      <MoleInstallGuide
        mode="onboarding"
        platform={status?.platform ?? 'linux'}
        checking={checking}
        onRecheck={onRecheck}
        onSkip={onSkip}
        onInstall={(command) => {
          setInstallCommand(command)
          setView('terminal')
        }}
      />
    </div>
  )
}
