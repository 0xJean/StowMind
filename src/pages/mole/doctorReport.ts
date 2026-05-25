import { formatDate, formatDecimal, formatFileSize } from '@/lib/utils'
import type { DiagnosticItem } from '../status/types'
import { formatMaybe, formatPercent, formatRate } from '../status/utils'
import { summarizeDoctorChecks } from './doctorInsights'
import type { MoleDoctorResult } from './doctorTypes'

type Translator = (key: any, vars?: Record<string, string | number>) => string

const ISSUE_BASE_URL =
  import.meta.env.VITE_STOWMIND_ISSUE_URL ||
  'https://github.com/0xJean/StowMind/issues/new'

function mdValue(value?: string | number | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : '-'
}

function mdLine(label: string, value?: string | number | null) {
  return `- ${label}: ${mdValue(value)}`
}

function fencedBlock(value: string) {
  return ['```text', value.trim() || '-', '```'].join('\n')
}

export function buildDoctorReport(data: MoleDoctorResult, diagnostics: DiagnosticItem[], t: Translator) {
  const status = data.status
  const primaryBattery = status.batteries[0]
  const issueCount = data.checks.filter((item) => item.level !== 'success').length
  const insightGroups = summarizeDoctorChecks(data.checks, t)
  const checks = data.checks.length
    ? data.checks
        .map((check) => [
          `- [${t(`status.level.${check.level}`)}] ${check.title}`,
          `  - ${check.detail}`,
          check.action ? `  - ${t('doctor.report.action')}: \`${check.action}\`` : null,
          check.section ? `  - ${t('doctor.report.section')}: ${check.section}` : null,
        ].filter(Boolean).join('\n'))
        .join('\n')
    : '-'
  const diagnosticLines = diagnostics.length
    ? diagnostics
        .map((item) => `- [${t(`status.level.${item.level}`)}] ${item.title}: ${item.detail}`)
        .join('\n')
    : '-'
  const insightLines = insightGroups
    .map((group) =>
      mdLine(
        `${group.title} [${t(`status.level.${group.level}`)}]`,
        t('doctor.report.insightSummary', {
          total: group.checks.length,
          issues: group.issueCount,
          sections: group.sourceSections.join(', ') || '-',
        })
      )
    )
    .join('\n')

  return [
    `# ${t('doctor.report.title')}`,
    '',
    `> ${t('doctor.report.summary', {
      score: data.health_score,
      issues: issueCount,
      platform: data.platform || status.platform || '-',
    })}`,
    '',
    `## ${t('doctor.report.overview')}`,
    mdLine(t('doctor.report.collectedAt'), formatDate(data.collected_at)),
    mdLine(t('doctor.report.platform'), data.platform || status.platform),
    mdLine(t('doctor.report.healthScore'), `${data.health_score} - ${data.health_score_msg}`),
    mdLine(t('doctor.report.update'), data.update_available ? t('doctor.metric.updateAvailable') : t('doctor.metric.updateClear')),
    mdLine(t('doctor.report.updateMessage'), data.update_message),
    mdLine(t('doctor.report.consoleCommand'), data.console_command),
    '',
    `## ${t('doctor.report.system')}`,
    mdLine(t('status.field.host'), status.host),
    mdLine(t('status.field.platform'), status.platform),
    mdLine(t('status.field.uptime'), status.uptime),
    mdLine(t('status.field.procs'), status.procs),
    mdLine(t('status.field.load'), `${formatDecimal(status.cpu.load1, 2)} / ${formatDecimal(status.cpu.load5, 2)} / ${formatDecimal(status.cpu.load15, 2)}`),
    mdLine(t('status.field.cpuCores'), `${status.cpu.core_count} / ${status.cpu.logical_cpu}`),
    mdLine(t('status.field.swap'), `${formatFileSize(status.memory.swap_used)} / ${formatFileSize(status.memory.swap_total)}`),
    mdLine(t('status.field.cached'), formatFileSize(status.memory.cached)),
    mdLine(t('status.field.pressure'), status.memory.pressure),
    mdLine(t('status.field.diskIo'), `${formatRate(status.disk_io.read_rate)} / ${formatRate(status.disk_io.write_rate)}`),
    '',
    `## ${t('doctor.report.hardware')}`,
    mdLine(t('status.field.model'), status.hardware.model),
    mdLine(t('status.field.cpuModel'), status.hardware.cpu_model),
    mdLine(t('status.field.totalRam'), status.hardware.total_ram),
    mdLine(t('status.field.diskSize'), status.hardware.disk_size),
    mdLine(t('status.field.osVersion'), status.hardware.os_version),
    '',
    `## ${t('doctor.report.storageAndPower')}`,
    ...(status.disks.length
      ? status.disks.map((disk) =>
          mdLine(
            `${disk.mount} (${formatMaybe(disk.device)})`,
            `${formatFileSize(disk.used)} / ${formatFileSize(disk.total)} (${formatPercent(disk.used_percent, 1)}), ${disk.fstype}${disk.external ? `, ${t('doctor.report.externalDisk')}` : ''}`
          )
        )
      : ['-']),
    mdLine(t('doctor.report.trash'), formatFileSize(status.trash_size)),
    mdLine(t('doctor.report.battery'), primaryBattery ? `${formatPercent(primaryBattery.percent, 0)} ${primaryBattery.status}` : null),
    '',
    `## ${t('doctor.report.insights')}`,
    insightLines,
    '',
    `## ${t('doctor.report.checks')}`,
    checks,
    '',
    `## ${t('doctor.report.diagnostics')}`,
    diagnosticLines,
    '',
    `## ${t('doctor.report.rawOutput')}`,
    fencedBlock(data.raw_output),
    '',
  ].join('\n')
}

export function buildDoctorIssueUrl(report: string) {
  const title = `StowMind Diagnostics: ${new Date().toISOString().slice(0, 10)}`
  const params = new URLSearchParams({
    title,
    body: report,
  })
  return `${ISSUE_BASE_URL}?${params.toString()}`
}
