import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { loadResultSnapshot, resultCacheKeys, saveResultSnapshot } from '@/lib/resultCache'
import { formatDate, formatDecimal, formatFileSize } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/tauri'
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import { FieldRow, SectionCard } from './status/StatusWidgets'
import { StatusAdvancedSection } from './status/StatusAdvancedSection'
import type { MoleStatusRaw } from './status/advancedTypes'
import { buildDiagnostics, findPrimaryDisk, sortProcesses } from './status/diagnostics'
import { buildHealthInsights } from './status/healthInsights'
import { StatusHealthPanel } from './status/StatusHealthPanel'
import { DIAGNOSTIC_VARIANT, formatMaybe, formatPercent, formatRate } from './status/utils'
import {
  appendStatusHistory,
  createEmptyStatusHistory,
  StatusBento,
  type ProcessSortKey,
  type StatusHistory,
} from './status/StatusBento'

export function StatusPage() {
  const { t } = useI18n()
  const location = useLocation()
  const active = location.pathname === '/status'
  const [data, setData] = useState<MoleStatusRaw | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawOpen, setRawOpen] = useState(false)
  const [history, setHistory] = useState<StatusHistory>(() => createEmptyStatusHistory())
  const [processSortKey, setProcessSortKey] = useState<ProcessSortKey>('cpu')
  const [pinnedPid, setPinnedPid] = useState<number | null>(null)
  const lastSnapshotWriteRef = useRef(0)
  const refreshInFlightRef = useRef(false)
  const hasDataRef = useRef(false)
  const lastErrorToastAtRef = useRef(0)

  const refresh = async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setLoading(true)
    try {
      const next = await invoke<MoleStatusRaw>('mole_status_raw_json')
      setData(next)
      hasDataRef.current = true
      if (Date.now() - lastSnapshotWriteRef.current > 15_000) {
        lastSnapshotWriteRef.current = Date.now()
        await saveResultSnapshot(resultCacheKeys.statusRaw, next)
      }
      const nextPrimaryDisk = findPrimaryDisk(next.disks)
      setHistory((current) => appendStatusHistory(current, next, nextPrimaryDisk))
      setError(null)
      lastErrorToastAtRef.current = 0
    } catch (err) {
      const message = String(err)
      setError(message)
      const now = Date.now()
      if (!hasDataRef.current || now - lastErrorToastAtRef.current > 15_000) {
        lastErrorToastAtRef.current = now
        toast.error(t('status.fail', { error: message }))
      }
    } finally {
      refreshInFlightRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!active) return
    void (async () => {
      const snapshot = await loadResultSnapshot<MoleStatusRaw>(resultCacheKeys.statusRaw)
      if (snapshot) {
        hasDataRef.current = true
        setData(snapshot.payload)
      }
      await refresh()
    })()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const primaryDisk = useMemo(() => findPrimaryDisk(data?.disks), [data])
  const sortedProcesses = useMemo(() => sortProcesses(data?.top_processes), [data])
  const diagnostics = useMemo(
    () => (data ? buildDiagnostics(data, primaryDisk, sortedProcesses[0], t) : []),
    [data, primaryDisk, sortedProcesses, t]
  )
  const healthInsights = useMemo(
    () => (data ? buildHealthInsights(data, primaryDisk, sortedProcesses[0], t) : []),
    [data, primaryDisk, sortedProcesses, t]
  )
  return (
    <div className="stow-page-wide">
      <div className="stow-page-header">
        <div>
          <p className="iqon-eyebrow mb-1">{t('eyebrow.system')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('status.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('status.subtitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data ? t('status.collectedAt', { value: formatDate(data.collected_at) }) : t('status.loading')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {t('status.refresh')}
          </Button>
        </div>
      </div>

      {error && !data && (
        <div className="iqon-card border-iqon-yellow/30 bg-iqon-yellow/10 p-4">
          <div className="flex items-center gap-2 font-bold text-iqon-yellow">
            <AlertTriangle className="h-5 w-5" />
            {t('status.errorTitle')}
          </div>
          <p className="mt-2 break-words text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      <StatusBento
        data={data}
        primaryDisk={primaryDisk}
        history={history}
        pinnedPid={pinnedPid}
        sortKey={processSortKey}
        onPinProcess={setPinnedPid}
        onSortProcess={setProcessSortKey}
        t={t}
      />

      <StatusHealthPanel
        score={data?.health_score ?? null}
        message={data?.health_score_msg ?? t('status.loading')}
        insights={healthInsights}
        t={t}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard title={t('status.systemTitle')} description={t('status.systemDesc')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              <FieldRow label={t('status.field.host')} value={formatMaybe(data?.host)} />
              <FieldRow label={t('status.field.platform')} value={formatMaybe(data?.platform)} />
              <FieldRow label={t('status.field.uptime')} value={formatMaybe(data?.uptime)} />
              <FieldRow label={t('status.field.procs')} value={String(data?.procs ?? '—')} />
              <FieldRow
                label={t('status.field.cpuCores')}
                value={
                  data
                    ? `${formatDecimal(data.cpu.core_count, 0)} / ${formatDecimal(data.cpu.logical_cpu, 0)}`
                    : '—'
                }
              />
            </div>
            <div>
              <FieldRow
                label={t('status.field.load')}
                value={
                  data
                    ? `${formatDecimal(data.cpu.load1, 2)} / ${formatDecimal(data.cpu.load5, 2)} / ${formatDecimal(data.cpu.load15, 2)}`
                    : '—'
                }
              />
              <FieldRow
                label={t('status.field.swap')}
                value={
                  data
                    ? `${formatFileSize(data.memory.swap_used)} / ${formatFileSize(data.memory.swap_total)}`
                    : '—'
                }
              />
              <FieldRow label={t('status.field.cached')} value={data ? formatFileSize(data.memory.cached) : '—'} />
              <FieldRow label={t('status.field.pressure')} value={data ? formatMaybe(data.memory.pressure) : '—'} />
              <FieldRow
                label={t('status.field.diskIo')}
                value={
                  data
                    ? `${formatRate(data.disk_io.read_rate)} / ${formatRate(data.disk_io.write_rate)}`
                    : '—'
                }
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title={t('status.hardwareTitle')} description={t('status.hardwareDesc')}>
          <FieldRow label={t('status.field.model')} value={formatMaybe(data?.hardware.model)} />
          <FieldRow label={t('status.field.cpuModel')} value={formatMaybe(data?.hardware.cpu_model)} />
          <FieldRow label={t('status.field.totalRam')} value={formatMaybe(data?.hardware.total_ram)} />
          <FieldRow label={t('status.field.diskSize')} value={formatMaybe(data?.hardware.disk_size)} />
          <FieldRow label={t('status.field.osVersion')} value={formatMaybe(data?.hardware.os_version)} />
          <FieldRow label={t('status.field.lastRefresh')} value={data ? formatDate(data.collected_at) : '—'} />
        </SectionCard>
      </div>

      <SectionCard title={t('status.diagnosticsTitle')} description={t('status.diagnosticsDesc')}>
        <div className="space-y-2">
          {diagnostics.map((item) => (
            <div key={`${item.title}-${item.detail}`} className="iqon-row flex items-start gap-3 px-4 py-3">
              <Badge variant={DIAGNOSTIC_VARIANT[item.level]} className="mt-0.5 shrink-0">
                {t(`status.level.${item.level}` as Parameters<typeof t>[0])}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{item.title}</p>
                <p className="break-words text-xs text-muted-foreground">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={t('status.disksTitle')} description={t('status.disksDesc')}>
        {data?.disks?.length ? (
          <div className="overflow-hidden rounded-2xl border border-iqon-border">
            <div className="grid grid-cols-[1.1fr_1.2fr_1fr_1fr_0.9fr_0.8fr] gap-3 border-b border-iqon-border bg-iqon-row px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <div>{t('status.disk.mount')}</div>
              <div>{t('status.disk.device')}</div>
              <div>{t('status.disk.used')}</div>
              <div>{t('status.disk.total')}</div>
              <div>{t('status.disk.percent')}</div>
              <div>{t('status.disk.flags')}</div>
            </div>
            <div className="divide-y divide-iqon-border">
              {data.disks
                .slice()
                .sort((a, b) => b.used_percent - a.used_percent)
                .map((disk) => (
                  <div key={`${disk.mount}-${disk.device}`} className="grid grid-cols-[1.1fr_1.2fr_1fr_1fr_0.9fr_0.8fr] gap-3 px-4 py-3 text-sm transition-colors hover:bg-iqon-row">
                    <div className="font-bold">{disk.mount}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{disk.device}</div>
                    <div className="tabular-nums">{formatFileSize(disk.used)}</div>
                    <div className="tabular-nums text-muted-foreground">{formatFileSize(disk.total)}</div>
                    <div className="tabular-nums">{formatPercent(disk.used_percent)}</div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Badge variant={disk.external ? 'warning' : 'secondary'}>
                        {disk.external ? t('status.disk.external') : t('status.disk.internal')}
                      </Badge>
                      <Badge variant="outline">{disk.fstype || '—'}</Badge>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('status.empty.disks')}</p>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard title={t('status.networkTitle')} description={t('status.networkDesc')}>
          {data?.network?.length ? (
            <div className="space-y-3">
              {data.network.map((item) => (
                <div key={item.name} className="iqon-row p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{item.name}</p>
                      <p className="break-all font-mono text-[11px] text-muted-foreground">{formatMaybe(item.ip)}</p>
                    </div>
                    <Badge variant="outline">{t('status.network.iface')}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <FieldRow label={t('status.network.rx')} value={formatRate(item.rx_rate_mbs)} />
                    <FieldRow label={t('status.network.tx')} value={formatRate(item.tx_rate_mbs)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('status.empty.network')}</p>
          )}
        </SectionCard>

        <SectionCard title={t('status.batteryTitle')} description={t('status.batteryDesc')}>
          {data?.batteries?.length ? (
            <div className="space-y-3">
              {data.batteries.map((battery, index) => (
                <div key={`${battery.status}-${index}`} className="iqon-row p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{t('status.battery.item', { n: index + 1 })}</p>
                      <p className="text-[11px] text-muted-foreground">{formatMaybe(battery.status)}</p>
                    </div>
                    <Badge variant={battery.percent < 20 ? 'warning' : 'success'}>{formatPercent(battery.percent)}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <FieldRow label={t('status.battery.health')} value={formatMaybe(battery.health)} />
                    <FieldRow label={t('status.battery.timeLeft')} value={formatMaybe(battery.time_left)} />
                    <FieldRow label={t('status.battery.cycles')} value={String(battery.cycle_count)} />
                    <FieldRow label={t('status.battery.capacity')} value={formatDecimal(battery.capacity, 1)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('status.empty.battery')}</p>
          )}
        </SectionCard>
      </div>

      <StatusAdvancedSection data={data} t={t} />

      <div className="iqon-card overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-iqon-row"
          onClick={() => setRawOpen((value) => !value)}
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <AlertTriangle className="h-4 w-4 text-iqon-yellow" />
            {t('status.rawTitle')}
          </span>
          {rawOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {rawOpen && (
          <div className="space-y-3 border-t border-iqon-border px-5 pb-5 pt-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="font-mono">{formatMaybe(data?.platform)}</Badge>
              <Badge variant="outline" className="font-mono">{formatMaybe(data?.host)}</Badge>
              <Badge variant="outline" className="font-mono">{data ? formatDate(data.collected_at) : '—'}</Badge>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl border border-iqon-border bg-iqon-row p-4 text-xs leading-relaxed text-muted-foreground">
              {JSON.stringify(data ?? {}, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
