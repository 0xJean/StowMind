import { formatDecimal } from '@/lib/utils'
import type { MoleGpu, MoleThermal } from './advancedTypes'

export type TemperatureKind = 'cpu' | 'gpu' | 'battery'

export interface TemperatureReading {
  kind: TemperatureKind
  value: number
}

export function getValidGpuUsage(gpu?: MoleGpu | null) {
  return typeof gpu?.usage === 'number' && Number.isFinite(gpu.usage) && gpu.usage >= 0
    ? gpu.usage
    : undefined
}

export function getValidTemperature(value: number | undefined | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function getValidFanSpeed(thermal?: MoleThermal | null) {
  if (!thermal || thermal.fan_count <= 0) return undefined
  return typeof thermal.fan_speed === 'number' && Number.isFinite(thermal.fan_speed) && thermal.fan_speed >= 0
    ? thermal.fan_speed
    : undefined
}

export function getPrimaryTemperature(thermal?: MoleThermal | null): TemperatureReading | null {
  const cpu = getValidTemperature(thermal?.cpu_temp)
  if (cpu !== undefined) return { kind: 'cpu', value: cpu }

  const gpu = getValidTemperature(thermal?.gpu_temp)
  if (gpu !== undefined) return { kind: 'gpu', value: gpu }

  const battery = getValidTemperature(thermal?.battery_temp)
  if (battery !== undefined) return { kind: 'battery', value: battery }

  return null
}

export function formatTemperature(value: number, digits = 0) {
  return `${formatDecimal(value, digits)}°C`
}

export function formatOptionalTemperature(value: number | undefined, digits = 0) {
  return value === undefined ? '—' : formatTemperature(value, digits)
}

export function formatOptionalPower(value: number | undefined | null, digits = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? `${formatDecimal(value, digits)} W`
    : '—'
}
