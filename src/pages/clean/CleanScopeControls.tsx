import { TerminalPanel } from '@/components/TerminalPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { open } from '@tauri-apps/api/dialog'
import { FolderOpen, Settings2 } from 'lucide-react'
import { useState } from 'react'

interface CleanScopeControlsProps {
  externalPath: string
  onExternalPathChange: (path: string) => void
  disabled?: boolean
}

export function CleanScopeControls({ externalPath, onExternalPathChange, disabled = false }: CleanScopeControlsProps) {
  const { t } = useI18n()
  const [showWhitelist, setShowWhitelist] = useState(false)

  const chooseExternalPath = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('clean.externalBrowseTitle'),
    })
    if (selected && typeof selected === 'string') onExternalPathChange(selected)
  }

  return (
    <>
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border/70 bg-surface-hover/60 p-4 text-left">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold text-muted-foreground">
          <Settings2 className="h-4 w-4 text-primary" />
          {t('clean.scopeTitle')}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={externalPath}
            onChange={(event) => onExternalPathChange(event.target.value)}
            placeholder={t('clean.externalPathPlaceholder')}
            disabled={disabled}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={() => void chooseExternalPath()} disabled={disabled}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('clean.externalBrowse')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowWhitelist(true)} disabled={disabled}>
            {t('clean.manageWhitelist')}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {externalPath.trim() ? t('clean.externalPathHint', { path: externalPath.trim() }) : t('clean.scopeHint')}
        </p>
      </div>

      {showWhitelist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex h-[min(80vh,42rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="font-semibold">{t('clean.whitelistTitle')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('clean.whitelistDesc')}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowWhitelist(false)}>
                {t('clean.closeWhitelist')}
              </Button>
            </div>
            <div className="min-h-0 flex-1 p-3">
              <TerminalPanel command="mo clean --whitelist" onClose={() => setShowWhitelist(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
