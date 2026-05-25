import type { MoleDoctorCheck, MoleDoctorLevel } from './doctorTypes'

type Translator = (key: any, vars?: Record<string, string | number>) => string

type DoctorInsightGroupId =
  | 'updates'
  | 'helpers'
  | 'logs'
  | 'configuration'
  | 'system'
  | 'environment'

interface DoctorInsightGroupDefinition {
  id: DoctorInsightGroupId
  titleKey: string
  descriptionKey: string
  patterns: string[]
}

export interface DoctorInsightGroup {
  id: DoctorInsightGroupId
  title: string
  description: string
  level: MoleDoctorLevel
  checks: MoleDoctorCheck[]
  successCount: number
  warningCount: number
  destructiveCount: number
  issueCount: number
  sourceSections: string[]
}

const GROUPS: DoctorInsightGroupDefinition[] = [
  {
    id: 'updates',
    titleKey: 'doctor.insight.updates',
    descriptionKey: 'doctor.insight.updatesDesc',
    patterns: ['update', 'upgrade', 'version', 'latest', 'brew', 'homebrew', '更新', '升级', '可更新', '系统更新'],
  },
  {
    id: 'helpers',
    titleKey: 'doctor.insight.helpers',
    descriptionKey: 'doctor.insight.helpersDesc',
    patterns: ['helper', 'daemon', 'agent', 'launch agent', 'service', 'privileged', 'background', '后台', '服务', '登录项'],
  },
  {
    id: 'logs',
    titleKey: 'doctor.insight.logs',
    descriptionKey: 'doctor.insight.logsDesc',
    patterns: ['log', 'report', 'diagnostic', 'crash', 'console', 'trace', '日志', '诊断', '崩溃', '报告'],
  },
  {
    id: 'configuration',
    titleKey: 'doctor.insight.configuration',
    descriptionKey: 'doctor.insight.configurationDesc',
    patterns: ['config', 'configuration', 'permission', 'touch id', 'touchid', 'full disk', 'login', 'startup', 'delete mode', 'license', 'activation', '配置', '权限', '安全', 'gatekeeper', '授权', '启动项', '删除策略'],
  },
  {
    id: 'system',
    titleKey: 'doctor.insight.system',
    descriptionKey: 'doctor.insight.systemDesc',
    patterns: ['disk', 'memory', 'battery', 'cpu', 'network', 'proxy', 'trash', 'storage', '磁盘', '内存', '电池', '网络', '代理', '废纸篓', '存储', '系统健康'],
  },
  {
    id: 'environment',
    titleKey: 'doctor.insight.environment',
    descriptionKey: 'doctor.insight.environmentDesc',
    patterns: ['path', 'shell', 'git', 'xcode', 'node', 'python', 'npm', 'pnpm', 'ruby', 'rust', 'cargo', '路径', '开发环境'],
  },
]

const LEVEL_WEIGHT: Record<MoleDoctorLevel, number> = {
  success: 0,
  warning: 1,
  destructive: 2,
}

function checkHaystack(check: MoleDoctorCheck) {
  return [check.section, check.title, check.detail, check.action ?? '']
    .join(' ')
    .toLowerCase()
}

function groupForCheck(check: MoleDoctorCheck) {
  const haystack = checkHaystack(check)
  return GROUPS.find((group) => group.patterns.some((pattern) => haystack.includes(pattern))) ?? GROUPS[GROUPS.length - 1]
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function strongestLevel(checks: MoleDoctorCheck[]): MoleDoctorLevel {
  return checks.reduce<MoleDoctorLevel>(
    (current, check) => (LEVEL_WEIGHT[check.level] > LEVEL_WEIGHT[current] ? check.level : current),
    'success'
  )
}

export function summarizeDoctorChecks(checks: MoleDoctorCheck[], t: Translator): DoctorInsightGroup[] {
  return GROUPS.map((group) => {
    const groupedChecks = checks.filter((check) => groupForCheck(check).id === group.id)
    const successCount = groupedChecks.filter((check) => check.level === 'success').length
    const warningCount = groupedChecks.filter((check) => check.level === 'warning').length
    const destructiveCount = groupedChecks.filter((check) => check.level === 'destructive').length
    const sourceSections = Array.from(
      new Set(groupedChecks.map((check) => check.section).filter(isNonEmptyString))
    )

    return {
      id: group.id,
      title: t(group.titleKey),
      description: t(group.descriptionKey),
      level: strongestLevel(groupedChecks),
      checks: groupedChecks,
      successCount,
      warningCount,
      destructiveCount,
      issueCount: warningCount + destructiveCount,
      sourceSections,
    }
  })
}
