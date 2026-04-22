import { TerminalPanel } from '@/components/TerminalPanel'
import { useI18n } from '@/i18n'
import { useDeepCleanStore } from '@/stores/deepclean'
import { open as openUrl } from '@tauri-apps/api/shell'
import { invoke } from '@tauri-apps/api/tauri'
import {
    Activity,
    ArrowLeft,
    Download,
    ExternalLink,
    FolderX,
    HardDrive,
    Loader2,
    PackageX,
    Terminal,
    Trash2,
    X,
    Zap,
    type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

type PageView = 'cards' | 'terminal'

interface CommandDef {
  cmd: string
  icon: LucideIcon
  titleKey: string
  descKey: string
}

const MOLE_GITHUB = 'https://github.com/tw93/Mole'

const COMMANDS: CommandDef[] = [
  { cmd: 'mo', icon: Terminal, titleKey: 'deepclean.cmd.mo', descKey: 'deepclean.cmd.moDesc' },
  { cmd: 'mo clean', icon: Trash2, titleKey: 'deepclean.cmd.clean', descKey: 'deepclean.cmd.cleanDesc' },
  { cmd: 'mo uninstall', icon: PackageX, titleKey: 'deepclean.cmd.uninstall', descKey: 'deepclean.cmd.uninstallDesc' },
  { cmd: 'mo optimize', icon: Zap, titleKey: 'deepclean.cmd.optimize', descKey: 'deepclean.cmd.optimizeDesc' },
  { cmd: 'mo analyze', icon: HardDrive, titleKey: 'deepclean.cmd.analyze', descKey: 'deepclean.cmd.analyzeDesc' },
  { cmd: 'mo status', icon: Activity, titleKey: 'deepclean.cmd.status', descKey: 'deepclean.cmd.statusDesc' },
  { cmd: 'mo purge', icon: FolderX, titleKey: 'deepclean.cmd.purge', descKey: 'deepclean.cmd.purgeDesc' },
  { cmd: 'mo installer', icon: Download, titleKey: 'deepclean.cmd.installer', descKey: 'deepclean.cmd.installerDesc' },
]

function MoleBrand({ version, githubUrl }: { version?: string | null; githubUrl: string }) {
  return (
    <button
      onClick={() => void openUrl(githubUrl)}
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-gradient-to-r from-amber-500/5 to-orange-500/5 px-4 py-2.5 transition-all hover:border-amber-500/40 hover:shadow-sm cursor-pointer"
      title="Mole — MIT License"
    >
      <img src="/mole.png" alt="Mole" className="w-7 h-7 rounded-lg" draggable={false} />
      <div className="text-left">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-foreground">Mole</span>
          {version && <span className="text-xs text-muted-foreground font-mono">v{version}</span>}
        </div>
        <span className="text-xs text-muted-foreground">Open-source · MIT License</span>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
    </button>
  )
}

function InstallGuide({ platform, onRecheck }: { platform: string; onRecheck: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8">
      <img src="/mole.png" alt="Mole" className="w-16 h-16 rounded-2xl" draggable={false} />
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">{t('deepclean.installTitle')}</h2>
        <p className="text-sm text-muted-foreground max-w-md">{t('deepclean.installDesc')}</p>
      </div>
      {platform === 'windows' ? (
        <div className="space-y-3 w-full max-w-md">
          <p className="text-xs text-muted-foreground">{t('deepclean.winRequirements')}</p>
          <div className="text-xs space-y-1 text-muted-foreground">
            <p>• PowerShell 5.1+ — {t('deepclean.winPreinstalled')}</p>
            <p>• Git — {t('deepclean.winGitRequired')}</p>
            <p>• Go 1.21+ — {t('deepclean.winGoOptional')}</p>
          </div>
          <code className="block bg-muted rounded-lg p-3 text-xs font-mono break-all">
            irm https://raw.githubusercontent.com/tw93/Mole/windows/install.ps1 | iex
          </code>
        </div>
      ) : (
        <div className="space-y-3 w-full max-w-md">
          <code className="block bg-muted rounded-lg p-3 text-xs font-mono break-all">
            brew install mole
          </code>
          <p className="text-xs text-muted-foreground">{t('deepclean.installAlt')}</p>
          <code className="block bg-muted rounded-lg p-3 text-xs font-mono break-all">
            curl -fsSL https://raw.githubusercontent.com/tw93/mole/main/install.sh | bash
          </code>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={() => void openUrl(MOLE_GITHUB)}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          {t('deepclean.viewGithub')} <ExternalLink className="w-3 h-3" />
        </button>
        <button
          onClick={onRecheck}
          className="text-sm px-4 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
        >
          {t('deepclean.recheck')}
        </button>
      </div>
    </div>
  )
}

export function DeepCleanPage() {
  const { t } = useI18n()
  const { moleStatus, moleChecked, setMoleStatus } = useDeepCleanStore()
  const [view, setView] = useState<PageView>('cards')
  const [activeCommand, setActiveCommand] = useState('')

  const checkMole = async () => {
    try {
      const status = await invoke<{ installed: boolean; version: string | null; platform: string }>('mole_check')
      setMoleStatus({
        installed: status.installed,
        version: status.version,
        platform: status.platform as 'macos' | 'windows' | 'linux',
      })
    } catch {
      setMoleStatus({ installed: false, version: null, platform: 'linux' })
    }
  }

  useEffect(() => {
    if (!moleChecked) {
      void checkMole()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installed = moleStatus?.installed ?? false

  // Loading
  if (!moleChecked) {
    return (
      <div className="flex items-center justify-center flex-1 gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>{t('deepclean.checking')}</span>
      </div>
    )
  }

  // Not installed
  if (!installed) {
    return (
      <div className="flex flex-col h-full">
        <InstallGuide
          platform={moleStatus?.platform ?? 'linux'}
          onRecheck={() => {
            useDeepCleanStore.setState({ moleChecked: false, moleStatus: null })
            void checkMole()
          }}
        />
      </div>
    )
  }

  // Terminal view
  if (view === 'terminal') {
    return (
      <div className="flex flex-col h-full bg-[#0d1117]">
        {/* macOS-style terminal title bar */}
        <div className="flex items-center h-10 px-4 bg-[#161b22] border-b border-[#30363d] shrink-0">
          {/* Traffic light dots / close button */}
          <button
            onClick={() => setView('cards')}
            className="group flex items-center gap-1.5 mr-4"
            title="Close terminal"
          >
            <span className="w-3 h-3 rounded-full bg-[#ff5f57] group-hover:bg-[#ff5f57]/80 flex items-center justify-center">
              <X className="w-2 h-2 text-[#4a0002] opacity-0 group-hover:opacity-100" />
            </span>
            <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          </button>
          {/* Command name centered */}
          <div className="flex-1 flex items-center justify-center">
            <span className="text-xs font-mono text-[#8b949e]">
              {activeCommand}
            </span>
          </div>
          {/* Back button */}
          <button
            onClick={() => setView('cards')}
            className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
        </div>
        <TerminalPanel command={activeCommand} onClose={() => setView('cards')} />
      </div>
    )
  }

  // Cards view
  return (
    <div className="flex flex-col h-full p-6 gap-6 overflow-auto">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <img src="/mole.png" alt="Mole" className="w-8 h-8 rounded-lg" draggable={false} />
            <h1 className="text-2xl font-bold">{t('deepclean.title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('deepclean.subtitle')}</p>
        </div>
        <MoleBrand version={moleStatus?.version} githubUrl={MOLE_GITHUB} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {COMMANDS.map((def) => {
          const Icon = def.icon
          return (
            <button
              key={def.cmd}
              disabled={!installed}
              onClick={() => {
                setActiveCommand(def.cmd)
                setView('terminal')
              }}
              className={`flex flex-col gap-3 rounded-xl border border-border p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm ${
                !installed ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
              }`}
            >
              <Icon className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm font-mono font-medium">{def.cmd}</p>
                <p className="text-xs text-muted-foreground mt-1">{t(def.descKey as Parameters<typeof t>[0])}</p>
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-center text-muted-foreground mt-auto pt-4">
        {t('deepclean.moleTagline')}
      </p>
    </div>
  )
}
