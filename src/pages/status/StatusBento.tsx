import { Sparkline } from '@/components/Sparkline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatFileSize } from '@/lib/utils'
import {
  Activity,
  BatteryCharging,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Pin,
  PinOff,
  Thermometer,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import type { MoleDisk } from './types'
import type { MoleProxy, MoleStatusRaw } from './advancedTypes'
import { processMetadata } from './processMetadata'
import { findPrimaryNetwork } from './diagnostics'
import { formatTemperature, getPrimaryTemperature, getValidFanSpeed, getValidGpuUsage } from './sensorReadings'
import { formatMaybe, formatPercent, formatRate } from './utils'

type BentoTone = 'green' | 'cyan' | 'purple' | 'yellow' | 'red'

const BENTO_TONE: Record<BentoTone, { stroke: string; text: string; glow: string; mesh: string; dot: string }> = {
  green: { stroke: 'stroke-iqon-green', text: 'text-iqon-green', glow: 'bg-iqon-green', mesh: 'text-iqon-green/40', dot: 'iqon-dot-green' },
  cyan: { stroke: 'stroke-iqon-cyan', text: 'text-iqon-cyan', glow: 'bg-iqon-cyan', mesh: 'text-iqon-cyan/40', dot: 'iqon-dot-cyan' },
  purple: { stroke: 'stroke-iqon-purple', text: 'text-iqon-purple', glow: 'bg-iqon-purple', mesh: 'text-iqon-purple/40', dot: 'iqon-dot-purple' },
  yellow: { stroke: 'stroke-iqon-yellow', text: 'text-iqon-yellow', glow: 'bg-iqon-yellow', mesh: 'text-iqon-yellow/40', dot: 'iqon-dot-yellow' },
  red: { stroke: 'stroke-iqon-red', text: 'text-iqon-red', glow: 'bg-iqon-red', mesh: 'text-iqon-red/40', dot: 'iqon-dot-red' },
}

export type StatusHistory = {
  health: number[]
  cpu: number[]
  memory: number[]
  disk: number[]
  gpu: number[]
  diskRead: number[]
  networkRx: number[]
  battery: number[]
  thermal: number[]
}

export type ProcessSortKey = 'cpu' | 'memory' | 'name'

export interface StatusBentoProps {
  data: MoleStatusRaw | null
  primaryDisk: MoleDisk | null
  history: StatusHistory
  pinnedPid: number | null
  sortKey: ProcessSortKey
  onPinProcess: (pid: number | null) => void
  onSortProcess: (key: ProcessSortKey) => void
  t: (key: any, vars?: Record<string, string | number>) => string
}

export function createEmptyStatusHistory(): StatusHistory {
  return {
    health: [],
    cpu: [],
    memory: [],
    disk: [],
    gpu: [],
    diskRead: [],
    networkRx: [],
    battery: [],
    thermal: [],
  }
}

export function appendStatusHistory(history: StatusHistory, data: MoleStatusRaw, primaryDisk: MoleDisk | null): StatusHistory {
  const network = findPrimaryNetwork(data.network)
  const battery = data.batteries[0]
  const gpu = data.gpu?.[0]
  const thermal = data.thermal
  const gpuUsage = getValidGpuUsage(gpu)
  const primaryTemperature = getPrimaryTemperature(thermal)

  return {
    health: appendPoint(history.health, data.health_score),
    cpu: appendPoint(history.cpu, data.cpu.usage),
    memory: appendPoint(history.memory, data.memory.used_percent),
    disk: appendPoint(history.disk, primaryDisk?.used_percent),
    gpu: appendPoint(history.gpu, gpuUsage),
    diskRead: appendPoint(history.diskRead, data.disk_io.read_rate),
    networkRx: appendPoint(history.networkRx, network?.rx_rate_mbs),
    battery: appendPoint(history.battery, battery?.percent),
    thermal: appendPoint(history.thermal, primaryTemperature?.value),
  }
}

export function StatusBento({
  data,
  primaryDisk,
  history,
  pinnedPid,
  sortKey,
  onPinProcess,
  onSortProcess,
  t,
}: StatusBentoProps) {
  const network = findPrimaryNetwork(data?.network)
  const battery = data?.batteries?.[0]
  const gpu = data?.gpu?.[0]
  const thermal = data?.thermal ?? null
  const gpuUsage = getValidGpuUsage(gpu)
  const primaryTemperature = getPrimaryTemperature(thermal)
  const fanSpeed = getValidFanSpeed(thermal)
  const proxy = data?.proxy ?? null

  const processes = useMemo(() => {
    const sorted = [...(data?.top_processes ?? [])].sort((a, b) => {
      if (a.pid === pinnedPid) return -1
      if (b.pid === pinnedPid) return 1
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      return b[sortKey] - a[sortKey] || a.pid - b.pid
    })
    return sorted.slice(0, 10)
  }, [data?.top_processes, pinnedPid, sortKey])

  return (
    <div className="space-y-4">
      {proxy?.enabled && <ProxyBanner proxy={proxy} t={t} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <BentoMetric
          icon={Activity}
          title={t('status.metric.health')}
          value={data ? String(data.health_score) : '—'}
          detail={data?.health_score_msg ?? t('status.loading')}
          values={history.health}
          tone="green"
        />
        <BentoMetric
          icon={Cpu}
          title={t('status.metric.cpu')}
          value={formatPercent(data?.cpu.usage)}
          detail={data ? t('status.bento.cpuDetail', { cores: data.cpu.logical_cpu }) : t('status.loading')}
          values={history.cpu}
          tone="cyan"
        />
        <BentoMetric
          icon={MemoryStick}
          title={t('status.metric.memory')}
          value={formatPercent(data?.memory.used_percent)}
          detail={data ? `${formatFileSize(data.memory.used)} / ${formatFileSize(data.memory.total)}` : t('status.loading')}
          values={history.memory}
          tone="purple"
        />
        <BentoMetric
          icon={HardDrive}
          title={t('status.metric.disk')}
          value={formatPercent(primaryDisk?.used_percent)}
          detail={primaryDisk ? `${primaryDisk.mount} · ${formatFileSize(primaryDisk.used)} / ${formatFileSize(primaryDisk.total)}` : t('status.loading')}
          values={history.disk}
          tone="yellow"
        />
        <BentoMetric
          icon={Gauge}
          title={t('status.metric.gpu')}
          value={formatPercent(gpuUsage)}
          detail={gpu ? gpu.name : t('status.bento.noGpu')}
          values={history.gpu}
          tone="cyan"
        />
        <BentoMetric
          icon={Zap}
          title={t('status.metric.diskIo')}
          value={formatRate(data?.disk_io.read_rate)}
          detail={data ? t('status.bento.diskIoDetail', { write: formatRate(data.disk_io.write_rate) }) : t('status.loading')}
          values={history.diskRead}
          tone="yellow"
        />
        <BentoMetric
          icon={Wifi}
          title={t('status.metric.network')}
          value={formatRate(network?.rx_rate_mbs)}
          detail={network ? t('status.bento.networkDetail', { tx: formatRate(network.tx_rate_mbs) }) : t('status.loading')}
          values={history.networkRx}
          tone="cyan"
        />
        <BentoMetric
          icon={BatteryCharging}
          title={t('status.metric.battery')}
          value={formatPercent(battery?.percent)}
          detail={battery ? `${formatMaybe(battery.status)} · ${formatMaybe(battery.health)}` : t('status.loading')}
          values={history.battery}
          tone="green"
        />
        <BentoMetric
          icon={Thermometer}
          title={t('status.metric.thermal')}
          value={primaryTemperature ? formatTemperature(primaryTemperature.value) : '—'}
          detail={fanSpeed === undefined ? t('status.bento.noThermal') : t('status.bento.thermalDetail', { fan: Math.round(fanSpeed) })}
          values={history.thermal}
          tone="red"
        />
      </div>

      <div className="iqon-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">{t('status.processesTitle')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('status.processesDesc')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={sortKey === 'cpu' ? 'default' : 'outline'} onClick={() => onSortProcess('cpu')}>
              {t('status.process.cpu')}
            </Button>
            <Button size="sm" variant={sortKey === 'memory' ? 'default' : 'outline'} onClick={() => onSortProcess('memory')}>
              {t('status.process.memory')}
            </Button>
            <Button size="sm" variant={sortKey === 'name' ? 'default' : 'outline'} onClick={() => onSortProcess('name')}>
              {t('status.process.name')}
            </Button>
          </div>
        </div>

        {processes.length ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-iqon-border">
            <div className="grid grid-cols-[auto_0.6fr_1.6fr_0.7fr_0.7fr_2fr] gap-3 border-b border-iqon-border bg-iqon-row px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <div>{t('status.process.pin')}</div>
              <div>{t('status.process.pid')}</div>
              <div>{t('status.process.name')}</div>
              <div>{t('status.process.cpu')}</div>
              <div>{t('status.process.memory')}</div>
              <div>{t('status.process.command')}</div>
            </div>
            <div className="space-y-1 p-2">
              {processes.map((process) => (
                <ProcessRow
                  key={process.pid}
                  process={process}
                  pinned={process.pid === pinnedPid}
                  onTogglePin={() => onPinProcess(process.pid === pinnedPid ? null : process.pid)}
                  t={t}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t('status.empty.processes')}</p>
        )}
      </div>
    </div>
  )
}

function ProcessRow({
  process,
  pinned,
  onTogglePin,
  t,
}: {
  process: MoleStatusRaw['top_processes'][number]
  pinned: boolean
  onTogglePin: () => void
  t: StatusBentoProps['t']
}) {
  const meta = processMetadata(process)
  const Icon = meta.icon

  return (
    <button
      type="button"
      onClick={onTogglePin}
      className="iqon-row iqon-row-hover grid w-full grid-cols-[auto_0.6fr_1.6fr_0.7fr_0.7fr_2fr] gap-3 px-4 py-3 text-left text-sm"
    >
      <div className="text-muted-foreground">
        {pinned ? <PinOff className="h-4 w-4 text-iqon-green" /> : <Pin className="h-4 w-4" />}
      </div>
      <div className="font-mono text-xs text-muted-foreground tabular-nums">{process.pid}</div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-iqon-border bg-iqon-card">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <span className="truncate font-bold text-foreground">{process.name}</span>
          <Badge variant="outline" className="shrink-0">{t(meta.labelKey)}</Badge>
          {pinned && <Badge variant="outline" className="shrink-0 border-iqon-green/40 text-iqon-green">{t('status.process.pinned')}</Badge>}
        </div>
      </div>
      <div className="tabular-nums">{formatPercent(process.cpu)}</div>
      <div className="tabular-nums">{formatPercent(process.memory)}</div>
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-muted-foreground">{process.command}</p>
      </div>
    </button>
  )
}

function BentoMetric({
  icon: Icon,
  title,
  value,
  detail,
  values,
  tone,
}: {
  icon: LucideIcon
  title: string
  value: string
  detail: string
  values: number[]
  tone: BentoTone
}) {
  const t = BENTO_TONE[tone]
  return (
    <div className="iqon-card iqon-card-hover relative overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className={`absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-[0.18] blur-[40px] ${t.glow}`} />
        <div className={`iqon-mesh-soft absolute inset-0 ${t.mesh}`} />
      </div>
      <div className="relative z-10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="iqon-eyebrow">{title}</p>
            <p className="mt-1 break-words text-2xl font-bold tabular-nums">{value}</p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-iqon-border bg-iqon-row">
            <Icon className={`h-5 w-5 ${t.text}`} />
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`iqon-dot ${t.dot}`} />
          <p className="min-h-[1rem] flex-1 break-words text-[11px] font-medium text-muted-foreground">{detail}</p>
        </div>
        <Sparkline values={values} colorClassName={t.stroke} />
      </div>
    </div>
  )
}

function ProxyBanner({ proxy, t }: { proxy: MoleProxy; t: StatusBentoProps['t'] }) {
  return (
    <div className="iqon-card flex flex-col gap-1 border-iqon-yellow/30 bg-iqon-yellow/10 p-4 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <span className="iqon-dot iqon-dot-yellow" />
        <span className="font-bold text-iqon-yellow">{t('status.proxy.title')}</span>
      </div>
      <span className="font-mono text-xs text-muted-foreground">{`${proxy.type}://${proxy.host}`}</span>
    </div>
  )
}

function appendPoint(values: number[], value: number | undefined) {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return [...values, safe].slice(-60)
}
