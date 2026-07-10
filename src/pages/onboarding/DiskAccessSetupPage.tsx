import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { CheckCircle2, FolderOpen, RefreshCw, Shield } from 'lucide-react'

type DiskAccessStatusKey =
  | 'diskAccessSetup.status.denied'
  | 'diskAccessSetup.status.granted'
  | 'diskAccessSetup.status.unknown'

interface DiskAccessSetupPageProps {
  status: string
  onOpenSettings: () => void
  onRestart: () => void
  onSkip: () => void
}

function statusKey(status: string): DiskAccessStatusKey {
  if (status === 'denied') return 'diskAccessSetup.status.denied'
  if (status === 'granted') return 'diskAccessSetup.status.granted'
  return 'diskAccessSetup.status.unknown'
}

export function DiskAccessSetupPage({
  status,
  onOpenSettings,
  onRestart,
  onSkip,
}: DiskAccessSetupPageProps) {
  const { t } = useI18n()

  return (
    <div className="flex min-h-full w-full items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border/70 bg-card shadow-clean">
        <div className="grid gap-6 p-6 md:grid-cols-[0.9fr_1.1fr] md:p-8">
          <div className="flex flex-col justify-between gap-8 rounded-2xl bg-primary p-6 text-primary-foreground">
            <div>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
                <Shield className="h-7 w-7" />
              </span>
              <h1 className="mt-6 text-2xl font-bold leading-tight">{t('diskAccessSetup.title')}</h1>
              <p className="mt-3 text-sm leading-6 text-white/80">{t('diskAccessSetup.subtitle')}</p>
            </div>
            <div className="grid gap-3 text-sm">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('diskAccessSetup.point.prompts')}</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('diskAccessSetup.point.coverage')}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-3">
              <span className="stow-icon-box">
                <FolderOpen className="h-5 w-5" />
              </span>
              <div>
                <p className="text-lg font-bold">{t('diskAccessSetup.cardTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('diskAccessSetup.cardDesc')}</p>
              </div>
            </div>

            <div className="mt-6 space-y-3 rounded-2xl border border-border/70 bg-surface-hover p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="font-semibold">{t('diskAccessSetup.currentStatus')}</span>
                <span className="font-semibold text-muted-foreground">
                  {t(statusKey(status))}
                </span>
              </div>
              <p className="leading-6 text-muted-foreground">{t('diskAccessSetup.regrantHint')}</p>
              <ol className="grid gap-2 pl-5 text-muted-foreground">
                <li className="list-decimal">{t('diskAccessSetup.regrantStep.remove')}</li>
                <li className="list-decimal">{t('diskAccessSetup.regrantStep.add')}</li>
                <li className="list-decimal">{t('diskAccessSetup.regrantStep.restart')}</li>
              </ol>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button onClick={onOpenSettings}>
                <Shield className="mr-2 h-4 w-4" />
                {t('diskAccessSetup.openSettings')}
              </Button>
              <Button variant="outline" onClick={onRestart}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('diskAccessSetup.restartAfterGrant')}
              </Button>
              <Button variant="ghost" onClick={onSkip}>
                {t('diskAccessSetup.skip')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
