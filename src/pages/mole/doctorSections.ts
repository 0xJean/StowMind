import type { HistoryRecord } from '@/stores/app'
import { translateDoctorCheck, translateDoctorSectionTitle, type DoctorTranslator } from './doctorI18n'
import type { MoleDoctorCheck, MoleDoctorLevel } from './doctorTypes'

const LEVEL_WEIGHT: Record<MoleDoctorLevel, number> = {
  success: 0,
  warning: 1,
  destructive: 2,
}

export interface DoctorSectionSummary {
  id: string
  title: string
  rawTitle: string
  level: MoleDoctorLevel
  checks: MoleDoctorCheck[]
  issueCount: number
  actionCount: number
}

export interface DoctorFailureSignal {
  id: string
  title: string
  detail: string
  timestamp: string
}

function strongestLevel(checks: MoleDoctorCheck[]): MoleDoctorLevel {
  return checks.reduce<MoleDoctorLevel>(
    (current, check) => (LEVEL_WEIGHT[check.level] > LEVEL_WEIGHT[current] ? check.level : current),
    'success'
  )
}

function sectionId(title: string, index: number) {
  return `${title || 'section'}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function summarizeDoctorSections(checks: MoleDoctorCheck[], t?: DoctorTranslator): DoctorSectionSummary[] {
  const groups = new Map<string, MoleDoctorCheck[]>()
  for (const check of checks) {
    const section = check.section?.trim() || 'Mole'
    groups.set(section, [...(groups.get(section) ?? []), check])
  }

  return Array.from(groups.entries()).map(([title, sectionChecks], index) => ({
    id: sectionId(title, index),
    title: t ? translateDoctorSectionTitle(title, t) : title,
    rawTitle: title,
    checks: t ? sectionChecks.map((check) => translateDoctorCheck(check, t)) : sectionChecks,
    level: strongestLevel(sectionChecks),
    issueCount: sectionChecks.filter((check) => check.level !== 'success').length,
    actionCount: sectionChecks.filter((check) => Boolean(check.action)).length,
  }))
}

export function collectRecentFailureSignals(records: HistoryRecord[], limit = 5): DoctorFailureSignal[] {
  return records
    .flatMap((record) => {
      const errors = [
        ...(record.cleanupSummary?.errors ?? []),
        ...(record.organizeErrors ?? []),
      ]
      if (errors.length === 0) return []
      return errors.map((error, index) => ({
        id: `${record.id}-${index}`,
        title: record.directory,
        detail: error,
        timestamp: record.timestamp,
      }))
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
}
