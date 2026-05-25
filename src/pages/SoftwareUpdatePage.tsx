import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { TerminalPanel } from '@/components/TerminalPanel'
import { useI18n } from '@/i18n'
import {
  checkMoleInstallation,
  fallbackMoleStatus,
  MOLE_UPDATE_COMMAND,
  type MoleInstallationStatus,
} from '@/lib/mole'
import { loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { formatDate } from '@/lib/utils'
import { useMoleStore } from '@/stores/mole'
import { invoke } from '@tauri-apps/api/tauri'
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Download, Loader2, RefreshCw, ShieldCheck, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { MoleInstallGuide } from './mole/MoleInstallGuide'
import type { MoleDoctorResult } from './mole/doctorTypes'
import { FieldRow, MetricCard, SectionCard } from './status/StatusWidgets'
import { formatMaybe } from './status/utils'

type PageView = 'status' | 'terminal'
type TerminalContext = 'install' | 'update'

interface ToolUpdateSnapshot {
  data: MoleDoctorResult | null
  status?: MoleInstallationStatus | null
}

function updateVariant(updateAvailable: boolean) {
  return updateAvailable ? 'warning' : 'success'
}

export function SoftwareUpdatePage() {
  const { t } = useI18n()
  const moleStatus = useMoleStore((s) => s.status)
  const moleChecked = useMoleStore((s) => s.checked)
  const moleUpdate = useMoleStore((s) => s.update)
  const setMoleStatus = useMoleStore((s) => s.setStatus)
  const startMoleCheck = useMoleStore((s) => s.startStatusCheck)
  const setMoleUpdateChecking = useMoleStore((s) => s.setUpdateChecking)
  const setMoleUpdateResult = useMoleStore((s) => s.setUpdateResult)
  const setMoleUpdateError = useMoleStore((s) => s.setUpdateError)
  const clearMoleUpdate = useMoleStore((s) => s.clearUpdate)
  const [data, setData] = useState<MoleDoctorResult | null>(null)
  const [view, setView] = useState<PageView>('status')
  const [terminalContext, setTerminalContext] = useState<TerminalContext>('update')
  const [terminalCommand, setTerminalCommand] = useState(MOLE_UPDATE_COMMAND)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (silent = false) => {
    setLoading(true)
    startMoleCheck()
    let installationChecked = false
    try {
      const status = await checkMoleInstallation()
      installationChecked = true
      setMoleStatus(status)

      if (!status.installed) {
        setData(null)
        setError(null)
        clearMoleUpdate()
        await saveToolUpdateSnapshot(null, status)
        return
      }

      setMoleUpdateChecking()
      const result = await invoke<MoleDoctorResult>('mole_doctor_json')
      setData(result)
      setMoleUpdateResult({
        updateAvailable: result.update_available,
        updateMessage: result.update_message,
        checkedAt: result.collected_at,
      })
      await saveToolUpdateSnapshot(result, status)
      setError(null)
    } catch (err) {
      const message = String(err)
      if (!installationChecked) setMoleStatus(fallbackMoleStatus())
      setError(message)
      setMoleUpdateError(message)
      if (!silent) toast.error(t('softwareUpdate.fail', { error: message }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      const snapshot = await loadResultSnapshot<ToolUpdateSnapshot>(resultCacheKeys.softwareUpdate)
      if (snapshot) {
        setData(snapshot.payload.data)
        if (snapshot.payload.status) setMoleStatus(snapshot.payload.status)
      }
      await refresh(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveToolUpdateSnapshot = async (
    nextData: MoleDoctorResult | null,
    nextStatus: MoleInstallationStatus | null
  ) => {
    await saveResultSnapshot<ToolUpdateSnapshot>(resultCacheKeys.softwareUpdate, {
      data: nextData,
      status: nextStatus,
    })
  }

  const handleTerminalClose = () => {
    setView('status')
    void refresh()
  }

  const openInstallTerminal = (command: string) => {
    setTerminalContext('install')
    setTerminalCommand(command)
    setView('terminal')
  }

  const openUpdateTerminal = () => {
    setTerminalContext('update')
    setTerminalCommand(MOLE_UPDATE_COMMAND)
    setView('terminal')
  }

  const updateAvailable = data?.update_available ?? moleUpdate.available
  const checkedAt = data?.collected_at ?? moleUpdate.checkedAt
  const version = moleStatus?.version ? `v${moleStatus.version}` : '—'
  const terminalTitle =
    terminalContext === 'install' ? t('moleSetup.installProgressTitle') : t('softwareUpdate.updateProgressTitle')
  const terminalDesc =
    terminalContext === 'install' ? t('moleSetup.installProgressDesc') : t('softwareUpdate.updateProgressDesc')
  const canShowInstallGuide = moleChecked && moleStatus?.installed === false && view !== 'terminal'

  if (view === 'terminal') {
    return (
      <div className="stow-page-wide flex min-h-full flex-col">
        <div className="stow-page-header">
          <div className="flex items-center gap-3">
            <span className="stow-icon-box">
              <Terminal className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold">{terminalTitle}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{terminalDesc}</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleTerminalClose}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('softwareUpdate.finishTerminal')}
          </Button>
        </div>

        <Card className="flex min-h-[36rem] flex-1 flex-col overflow-hidden">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 bg-surface-hover/70 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <span className="truncate text-xs font-semibold text-muted-foreground">{terminalTitle}</span>
            </div>
            <Badge variant="success">{t('softwareUpdate.running')}</Badge>
          </div>
          <div className="min-h-0 flex-1">
            <TerminalPanel command={terminalCommand} onClose={handleTerminalClose} />
          </div>
        </Card>
      </div>
    )
  }

  if (canShowInstallGuide) {
    return (
      <div className="stow-page-wide flex min-h-full items-center justify-center">
        <MoleInstallGuide
          platform={moleStatus?.platform ?? 'linux'}
          checking={loading}
          onRecheck={() => void refresh()}
          onInstall={openInstallTerminal}
        />
      </div>
    )
  }

  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.optimize')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('softwareUpdate.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('softwareUpdate.subtitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {checkedAt ? t('softwareUpdate.collectedAt', { value: formatDate(checkedAt) }) : t('softwareUpdate.loading')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {t('softwareUpdate.refresh')}
          </Button>
          {updateAvailable && (
            <Button onClick={openUpdateTerminal}>
              <Download className="mr-2 h-4 w-4" />
              {t('softwareUpdate.runUpdate')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="font-bold text-destructive">{t('softwareUpdate.errorTitle')}</p>
          <p className="mt-1 break-words text-muted-foreground">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={updateAvailable ? AlertTriangle : CheckCircle2}
          title={t('softwareUpdate.metric.state')}
          value={updateAvailable ? t('softwareUpdate.state.available') : t('softwareUpdate.state.clear')}
          detail={updateAvailable ? t('softwareUpdate.metric.updateAvailableDetail') : t('softwareUpdate.metric.stateDetail')}
          variant={updateVariant(updateAvailable)}
        />
        <MetricCard
          icon={ShieldCheck}
          title={t('softwareUpdate.metric.version')}
          value={version}
          detail={t('softwareUpdate.metric.versionDetail')}
        />
        <MetricCard
          icon={Clock3}
          title={t('softwareUpdate.metric.lastChecked')}
          value={checkedAt ? t('softwareUpdate.metric.checked') : '—'}
          detail={checkedAt ? formatDate(checkedAt) : t('softwareUpdate.metric.notChecked')}
        />
        <MetricCard
          icon={Download}
          title={t('softwareUpdate.metric.scope')}
          value={t('softwareUpdate.metric.toolStatus')}
          detail={t('softwareUpdate.metric.scopeDetail')}
        />
      </div>

      <SectionCard title={t('softwareUpdate.statusTitle')} description={t('softwareUpdate.statusDesc')}>
        <FieldRow label={t('softwareUpdate.field.version')} value={version} />
        <FieldRow label={t('softwareUpdate.field.platform')} value={formatMaybe(moleStatus?.platform)} />
        <FieldRow label={t('softwareUpdate.field.osVersion')} value={formatMaybe(data?.status.hardware.os_version)} />
        <FieldRow
          label={t('softwareUpdate.field.lastChecked')}
          value={checkedAt ? formatDate(checkedAt) : '—'}
        />
      </SectionCard>

      <SectionCard title={t('softwareUpdate.actionTitle')} description={t('softwareUpdate.actionDesc')}>
        <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-surface-hover p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={updateAvailable ? 'warning' : 'success'}>
                {updateAvailable ? t('softwareUpdate.state.available') : t('softwareUpdate.state.clear')}
              </Badge>
              {moleUpdate.checking && <Badge variant="outline">{t('softwareUpdate.checking')}</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {updateAvailable ? t('softwareUpdate.updateAvailableDesc') : t('softwareUpdate.noUpdateDesc')}
            </p>
          </div>
          {updateAvailable ? (
            <Button onClick={openUpdateTerminal}>
              <Download className="mr-2 h-4 w-4" />
              {t('softwareUpdate.runUpdate')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              {t('softwareUpdate.refresh')}
            </Button>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
