import type { MoleDoctorCheck } from './doctorTypes'

export type DoctorTranslator = (key: any, vars?: Record<string, string | number>) => string

interface DoctorTextPattern {
  match: RegExp
  key: string
  buildVars?: (match: RegExpMatchArray) => Record<string, string | number>
}

const SECTION_KEYS: Record<string, string> = {
  'system updates': 'doctor.check.section.systemUpdates',
  'system health': 'doctor.check.section.systemHealth',
  'security status': 'doctor.check.section.securityStatus',
  suggestions: 'doctor.check.section.suggestions',
  configuration: 'doctor.check.section.configuration',
  permissions: 'doctor.check.section.permissions',
  'developer environment': 'doctor.check.section.developerEnvironment',
  environment: 'doctor.check.section.environment',
  storage: 'doctor.check.section.storage',
  cleanup: 'doctor.check.section.cleanup',
}

const TITLE_KEYS: Record<string, string> = {
  homebrew: 'doctor.check.title.homebrew',
  macos: 'doctor.check.title.macos',
  memory: 'doctor.check.title.memory',
  gatekeeper: 'doctor.check.title.gatekeeper',
  'run brew upgrade to update': 'doctor.check.title.runBrewUpgrade',
  'system updates': 'doctor.check.section.systemUpdates',
  'system health': 'doctor.check.section.systemHealth',
  'security status': 'doctor.check.section.securityStatus',
  suggestions: 'doctor.check.section.suggestions',
}

const DETAIL_PATTERNS: DoctorTextPattern[] = [
  {
    match: /^(\d+) formula, (\d+) cask available$/i,
    key: 'doctor.check.detail.homebrewAvailable',
    buildVars: (match) => ({ formula: match[1], cask: match[2] }),
  },
  {
    match: /^macOS (.+)$/i,
    key: 'doctor.check.detail.macosVersion',
    buildVars: (match) => ({ version: match[1] }),
  },
  {
    match: /^(\d+)% used, (.+)$/i,
    key: 'doctor.check.detail.memoryUsed',
    buildVars: (match) => ({ percent: match[1], levelKey: levelWordKey(match[2]), levelRaw: match[2] }),
  },
  {
    match: /^App security disabled$/i,
    key: 'doctor.check.detail.appSecurityDisabled',
  },
]

function normalize(value?: string | null) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function levelWordKey(value: string) {
  const normalized = normalize(value)
  if (normalized === 'high') return 'doctor.check.level.high'
  if (normalized === 'medium') return 'doctor.check.level.medium'
  if (normalized === 'low') return 'doctor.check.level.low'
  return 'doctor.check.level.raw'
}

function translateByKey(value: string | undefined, map: Record<string, string>, t: DoctorTranslator) {
  const key = map[normalize(value)]
  return key ? t(key) : value ?? ''
}

function translatePattern(value: string | undefined, patterns: DoctorTextPattern[], t: DoctorTranslator) {
  const raw = value ?? ''
  for (const pattern of patterns) {
    const match = raw.match(pattern.match)
    if (match) {
      const vars = pattern.buildVars?.(match) ?? {}
      if ('levelKey' in vars) {
        const level = t(vars.levelKey, { value: String(vars.levelRaw ?? '') })
        return t(pattern.key, { ...vars, level })
      }
      return t(pattern.key, vars)
    }
  }
  return raw
}

export function translateDoctorSectionTitle(title: string | undefined, t: DoctorTranslator) {
  return translateByKey(title, SECTION_KEYS, t)
}

export function translateDoctorText(value: string | undefined, t: DoctorTranslator) {
  const section = translateDoctorSectionTitle(value, t)
  if (section !== (value ?? '')) return section
  const title = translateByKey(value, TITLE_KEYS, t)
  if (title !== (value ?? '')) return title
  return translatePattern(value, DETAIL_PATTERNS, t)
}

export function translateDoctorCheck(check: MoleDoctorCheck, t: DoctorTranslator): MoleDoctorCheck {
  return {
    ...check,
    section: translateDoctorSectionTitle(check.section, t),
    title: translateByKey(check.title, TITLE_KEYS, t),
    detail: translatePattern(check.detail, DETAIL_PATTERNS, t),
  }
}

export function translateDoctorChecks(checks: MoleDoctorCheck[], t: DoctorTranslator) {
  return checks.map((check) => translateDoctorCheck(check, t))
}
