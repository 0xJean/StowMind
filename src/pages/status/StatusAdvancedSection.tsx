import { Sparkline } from '@/components/Sparkline'
import { Badge } from '@/components/ui/badge'
import { formatFileSize } from '@/lib/utils'
import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import type { MoleStatusRaw } from './advancedTypes'
import { SectionCard } from './StatusWidgets'
import {
  formatOptionalPower,
  formatOptionalTemperature,
  getValidFanSpeed,
  getValidGpuUsage,
  getValidTemperature,
} from './sensorReadings'
import { formatMaybe, formatPercent, formatRate } from './utils'

type Translate = (key: any, vars?: Record<string, string | number>) => string

export function StatusAdvancedSection({
  data,
  t,
}: {
  data: MoleStatusRaw | null
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const gpu = data?.gpu?.[0]
  const thermal = data?.thermal ?? null
  const networkHistory = data?.network_history ?? null
  const processAlerts = data?.process_alerts ?? []
  const hasGpu = Boolean(gpu)
  const hasThermal = Boolean(thermal)
  const hasNetworkHistory = Boolean(networkHistory)
  const hasAlerts = processAlerts.length > 0
  const hasAny = hasGpu || hasThermal || hasNetworkHistory || hasAlerts

  return (
    <div className="iqon-card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-iqon-row"
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <div className="flex items-center gap-2 text-sm font-bold">
            <TrendingUp className="h-4 w-4 text-iqon-cyan" />
            {t('statusAdvanced.title')}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('statusAdvanced.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasAlerts && (
            <Badge variant="warning" className="shrink-0">
              {processAlerts.length}
            </Badge>
          )}
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-iqon-border p-5">
          {!hasAny && (
            <p className="text-xs text-muted-foreground">{t('status.loading')}</p>
          )}

          {(hasGpu || hasThermal) && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {hasGpu && <GpuPanel data={data!} t={t} />}
              {hasThermal && <ThermalPanel data={data!} t={t} />}
            </div>
          )}

          {hasNetworkHistory && <NetworkHistoryPanel data={data!} t={t} />}

          {hasAlerts && <ProcessAlertsPanel data={data!} t={t} />}
        </div>
      )}
    </div>
  )
}

function GpuPanel({ data, t }: { data: MoleStatusRaw; t: Translate }) {
  const gpu = data.gpu?.[0]
  if (!gpu) return null
  const usage = getValidGpuUsage(gpu)
  return (
    <SectionCard title={t('statusAdvanced.gpuTitle')} description={t('statusAdvanced.gpuDesc')}>
      <div className="grid grid-cols-2 gap-2">
        <AdvancedField label={t('statusAdvanced.field.gpuName')} value={gpu.name} />
        <AdvancedField label={t('statusAdvanced.field.gpuCores')} value={String(gpu.core_count)} />
        <AdvancedField
          label={t('statusAdvanced.field.gpuMemory')}
          value={gpu.memory_total ? `${formatFileSize(gpu.memory_used)} / ${formatFileSize(gpu.memory_total)}` : '—'}
        />
        <AdvancedField label={t('statusAdvanced.field.gpuUsage')} value={formatPercent(usage)} />
        <AdvancedField label={t('statusAdvanced.field.gpuNote')} value={formatMaybe(gpu.note)} />
      </div>
    </SectionCard>
  )
}

function ThermalPanel({ data, t }: { data: MoleStatusRaw; t: Translate }) {
  const thermal = data.thermal
  if (!thermal) return null
  const cpuTemp = getValidTemperature(thermal.cpu_temp)
  const gpuTemp = getValidTemperature(thermal.gpu_temp)
  const batteryTemp = getValidTemperature(thermal.battery_temp)
  const fanSpeed = getValidFanSpeed(thermal)
  return (
    <SectionCard title={t('statusAdvanced.thermalTitle')} description={t('statusAdvanced.thermalDesc')}>
      <div className="grid grid-cols-2 gap-2">
        <AdvancedField label={t('statusAdvanced.field.cpuTemp')} value={formatOptionalTemperature(cpuTemp)} />
        <AdvancedField label={t('statusAdvanced.field.gpuTemp')} value={formatOptionalTemperature(gpuTemp)} />
        <AdvancedField label={t('statusAdvanced.field.batteryTemp')} value={formatOptionalTemperature(batteryTemp, 1)} />
        <AdvancedField
          label={t('statusAdvanced.field.fans')}
          value={fanSpeed === undefined ? '—' : `${Math.round(fanSpeed)} RPM`}
        />
        <AdvancedField
          label={t('statusAdvanced.field.power')}
          value={`${formatOptionalPower(thermal.system_power)} / ${formatOptionalPower(thermal.adapter_power)}`}
        />
        <AdvancedField label={t('statusAdvanced.field.batteryPower')} value={formatOptionalPower(thermal.battery_power)} />
      </div>
    </SectionCard>
  )
}

function NetworkHistoryPanel({ data, t }: { data: MoleStatusRaw; t: Translate }) {
  const history = data.network_history
  if (!history) return null
  return (
    <SectionCard title={t('statusAdvanced.networkHistoryTitle')} description={t('statusAdvanced.networkDesc')}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="iqon-row p-4">
          <div className="flex items-center justify-between">
            <p className="iqon-eyebrow">{t('statusAdvanced.field.rxHistory')}</p>
            <span className="text-xs font-bold tabular-nums text-iqon-green">
              {formatRate(history.rx_history?.[history.rx_history.length - 1])}
            </span>
          </div>
          <div className="mt-3">
            <Sparkline values={history.rx_history} colorClassName="stroke-iqon-green" />
          </div>
        </div>
        <div className="iqon-row p-4">
          <div className="flex items-center justify-between">
            <p className="iqon-eyebrow">{t('statusAdvanced.field.txHistory')}</p>
            <span className="text-xs font-bold tabular-nums text-iqon-cyan">
              {formatRate(history.tx_history?.[history.tx_history.length - 1])}
            </span>
          </div>
          <div className="mt-3">
            <Sparkline values={history.tx_history} colorClassName="stroke-iqon-cyan" />
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function ProcessAlertsPanel({ data, t }: { data: MoleStatusRaw; t: Translate }) {
  const alerts = data.process_alerts ?? []
  return (
    <SectionCard title={t('statusAdvanced.alertsTitle')} description={t('statusAdvanced.alertsDesc')}>
      <div className="space-y-2">
        {alerts.map((alert, index) => (
          <div key={`${alert.title ?? alert.name ?? index}`} className="iqon-row p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-bold text-foreground">
                {alert.title ?? alert.name ?? t('statusAdvanced.alertFallback')}
              </p>
              <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'} className="shrink-0">
                {alert.severity ?? t('statusAdvanced.alert')}
              </Badge>
            </div>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {alert.detail ?? alert.message ?? t('statusAdvanced.alertEmpty')}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function AdvancedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="iqon-row p-3">
      <p className="iqon-eyebrow">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-foreground">{value}</p>
    </div>
  )
}
