import type { DiagnosticLevel } from './types'

export const DIAGNOSTIC_VARIANT: Record<DiagnosticLevel, 'success' | 'warning' | 'destructive'> = {
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
}

export function clampPercent(value: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function formatPercent(value: number | undefined, digits = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function formatRate(value: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)} MB/s`
}

export function formatMaybe(value?: string | null) {
  const text = value?.trim()
  return text && text.length > 0 ? text : '—'
}
