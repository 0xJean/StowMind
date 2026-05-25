import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { buildMoleInstallCommand, MOLE_GITHUB, type MolePlatform } from '@/lib/mole'
import { open as openUrl } from '@tauri-apps/api/shell'
import { CheckCircle2, Download, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'

interface MoleInstallGuideProps {
  platform: MolePlatform | string
  mode?: 'onboarding' | 'required'
  checking?: boolean
  onInstall: (command: string) => void
  onRecheck: () => void
  onSkip?: () => void
}

export function MoleInstallGuide({
  platform,
  mode = 'required',
  checking = false,
  onInstall,
  onRecheck,
  onSkip,
}: MoleInstallGuideProps) {
  const { t } = useI18n()
  const installCommand = buildMoleInstallCommand(platform)
  const isOnboarding = mode === 'onboarding'
  const platformLabel =
    platform === 'macos'
      ? t('moleSetup.platform.macos')
      : platform === 'windows'
        ? t('moleSetup.platform.windows')
        : t('moleSetup.platform.linux')

  return (
    <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-border/70 bg-card shadow-clean">
      <div className="grid gap-8 p-6 md:grid-cols-[0.9fr_1.1fr] md:p-8">
        <div className="flex flex-col justify-between gap-8 rounded-2xl bg-primary p-6 text-primary-foreground">
          <div>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
              <img src="/mole.png" alt="Mole" className="h-9 w-9 rounded-xl" draggable={false} />
            </span>
            <h1 className="mt-6 text-2xl font-bold leading-tight">
              {isOnboarding ? t('moleSetup.title') : t('moleSetup.requiredTitle')}
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/80">
              {isOnboarding ? t('moleSetup.subtitle') : t('moleSetup.requiredSubtitle')}
            </p>
          </div>
          <div className="grid gap-3 text-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('moleSetup.point.clean')}</span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('moleSetup.point.apps')}</span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('moleSetup.point.status')}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-3">
            <span className="stow-icon-box">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-bold">{t('moleSetup.detectedMissing')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('moleSetup.detectedMissingDesc')}</p>
            </div>
          </div>

          <div className="mt-6 space-y-3 rounded-2xl border border-border/70 bg-surface-hover p-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <span className="font-semibold">{t('moleSetup.platform')}</span>
              <span className="font-semibold text-muted-foreground">{platformLabel}</span>
            </div>
            <p className="leading-6 text-muted-foreground">{t('moleSetup.installNote')}</p>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button onClick={() => onInstall(installCommand)}>
              <Download className="mr-2 h-4 w-4" />
              {isOnboarding ? t('moleSetup.installAndContinue') : t('moleSetup.install')}
            </Button>
            <Button variant="outline" onClick={onRecheck} disabled={checking}>
              <RefreshCw className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
              {t('moleSetup.recheck')}
            </Button>
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                {t('moleSetup.skip')}
              </Button>
            )}
          </div>

          <button
            type="button"
            className="mt-6 inline-flex w-fit items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => void openUrl(MOLE_GITHUB)}
          >
            {t('moleSetup.viewSource')}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
