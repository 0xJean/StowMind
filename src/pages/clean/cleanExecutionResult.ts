import type { MoleCleanItem, MoleCleanPreview } from './types'

export interface CleanExecutionSummary {
  itemCount: number | null
  itemCountSource: 'mole' | 'operation_log' | 'unknown'
  /** Only a literal final Space freed report may populate this metric. */
  totalSize: number | null
  processedSize: number | null
  processedSizeKind: 'reported' | 'at_least' | 'partial' | 'unspecified' | 'unavailable'
  operationCount: number
  failedCount: number
  skippedCount: number
  operationLogStatus: 'available' | 'unavailable' | 'ambiguous'
}

export interface CleanOperationRecord {
  action: 'REMOVED' | 'TRASHED' | 'FAILED' | 'SKIPPED'
  label: string
  runId: string | null
}

export function buildExecutedCleanPreview(
  preview: MoleCleanPreview,
  summary: CleanExecutionSummary,
  rawOutput: string,
  options: { confirmedSectionTitle?: string } = {},
): MoleCleanPreview {
  const sections = buildExecutedSections(rawOutput, options.confirmedSectionTitle)
  return {
    ...preview,
    potential_space: summary.totalSize,
    item_count: summary.itemCount,
    // Operation logs confirm individual paths, not Mole's category totals.
    category_count: summary.itemCount === 0 ? 0 : null,
    summary_status: summary.totalSize === null ? 'unavailable' : 'exact',
    scan_status: 'complete',
    sections,
    raw_output: rawOutput,
  }
}

export function summarizeCleanExecution(
  lines: string[],
  rawOutput: string,
  operationLog: string,
): CleanExecutionSummary {
  const log = inspectOperationLog(collectLines(lines, rawOutput, operationLog).join('\n'))
  // The complete PTY response is authoritative. Live output can contain stale
  // earlier blocks and is only a fallback when no response was captured.
  const stdout = splitCleanOperationLog(rawOutput.trim() ? rawOutput : lines.join('\n')).rawOutput
  const block = finalSummaryLines(stdout)
  const trackedLine = [...block].reverse().find((line) => /^Tracked cleanup:/i.test(line))
  const freedLine = [...block].reverse().find((line) => /^Space freed:/i.test(line))
  const tracked = trackedLine?.match(/^Tracked cleanup:\s*([^|]*?)(?:\s*\|\s*Items cleaned:\s*([^|]+))?\s*$/i)
  const freed = freedLine?.match(/^Space freed:\s*([^|]*?)(?:\s*\|\s*Items cleaned:\s*([^|]+))?(?:\s*\|\s*Categories:\s*([0-9,]+))?\s*$/i)
  const processed = trackedLine !== undefined
    ? parseProcessedSize(tracked?.[1] ?? '')
    : { size: parseBytes(log.footer?.size ?? ''), kind: 'unspecified' as const }
  const processedSizeKind = processed.kind === 'unspecified' && processed.size === null ? 'unavailable' : processed.kind
  const reportedCount = parseCount(freed?.[2]) ?? parseCount(tracked?.[2]) ?? parseCount(log.footer?.count)
  const operationCount = log.records.filter((record) => record.action === 'REMOVED' || record.action === 'TRASHED').length
  return {
    itemCount: reportedCount ?? (operationCount || null),
    itemCountSource: reportedCount !== null ? 'mole' : operationCount > 0 ? 'operation_log' : 'unknown',
    totalSize: parseBytes(freed?.[1] ?? ''),
    processedSize: processed.size, processedSizeKind, operationCount,
    failedCount: log.records.filter((record) => record.action === 'FAILED').length,
    skippedCount: log.records.filter((record) => record.action === 'SKIPPED').length,
    operationLogStatus: log.status,
  }
}

export function buildCleanExecutionOutputLines(
  liveLines: string[],
  rawOutput: string,
  operationLog: string,
) {
  const lines = collectLines(liveLines, rawOutput, operationLog)
  const result: string[] = []
  let previous = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === previous) continue
    result.push(trimmed)
    previous = trimmed
  }

  return result.slice(-160)
}

export function splitCleanOperationLog(value: string) {
  const marker = /^[\t ]*Mole operation log:[\t ]*\r?$/m.exec(value)
  if (!marker) return { rawOutput: value, operationLog: '' }
  return {
    rawOutput: value.slice(0, marker.index).trimEnd(),
    operationLog: value.slice(marker.index + marker[0].length).trim(),
  }
}

export function combineCleanRawOutput(rawOutput: string, operationLog: string) {
  if (!operationLog.trim()) return rawOutput
  const separator = rawOutput.trim() ? '\n\nMole operation log:\n' : 'Mole operation log:\n'
  return rawOutput.trimEnd() + separator + operationLog.trimEnd()
}

function collectLines(lines: string[], rawOutput: string, operationLog: string) {
  return [
    ...lines,
    ...splitLines(rawOutput),
    ...splitLines(operationLog),
  ]
}

function splitLines(value: string) {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').split(/\r\n?|\n/)
    .map((line) => line.trim()).filter(Boolean)
}

function finalSummaryLines(value: string) {
  const lines = splitLines(value)
  let start = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (/^Cleanup\s+(?:complete|incomplete|cancelled|interrupted)\b[^\r\n]*$/i.test(lines[index])) start = index + 1
  }
  return lines.slice(start)
}

function parseCount(value: string | undefined): number | null {
  if (!value || !/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(value.trim())) return null
  const count = Number(value.trim().replace(/,/g, ''))
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

function parseBytes(value: string): number | null {
  const match = value.trim().match(/^((?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?)\s*([KMGT]?B)$/i)
  if (!match) return null
  const multiplier = 1024 ** ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(match[2].toUpperCase())
  const bytes = Math.round(Number(match[1].replace(/,/g, '')) * multiplier)
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null
}

function parseProcessedSize(value: string): { size: number | null, kind: CleanExecutionSummary['processedSizeKind'] } {
  if (/^Partially measured$/i.test(value.trim())) return { size: null, kind: 'partial' }
  const lowerBound = /^At\s+least\s+/i.test(value.trim())
  const size = parseBytes(value.trim().replace(/^At\s+least\s+/i, ''))
  return { size, kind: size === null ? 'unavailable' : lowerBound ? 'at_least' : 'reported' }
}

function buildExecutedSections(
  rawOutput: string,
  confirmedSectionTitle?: string,
) {
  const items: MoleCleanItem[] = parseCleanOperationLog(rawOutput)
    .filter((record) => record.action === 'REMOVED' || record.action === 'TRASHED')
    .map((record) => ({ label: record.label, size: null, count: 1, status: 'ok' }))
  return items.length > 0
    ? [{ title: confirmedSectionTitle ?? 'Confirmed cleaned items', items }]
    : []
}

interface SessionMarker {
  index: number
  runId: string | null
  ended: boolean
  count?: string
  size?: string
}

function sessionMarker(line: string, index: number): SessionMarker | null {
  const start = line.match(/^#\s*=+\s*clean(?: run=([a-z0-9-]+))? session started at [^\r\n=]+\s*=+$/i)
  if (start) return { index, runId: start[1] ?? null, ended: false }
  const end = line.match(/^#\s*=+\s*clean(?: run=([a-z0-9-]+))? session ended at [^,\r\n]+,\s*([^\s]+)\s+items?,\s*([^=\r\n]+?)\s*=+$/i)
  return end ? { index, runId: end[1] ?? null, ended: true, count: end[2], size: end[3] } : null
}

function operationRecord(line: string): CleanOperationRecord | null {
  const match = line.match(/^(?:\[[^\]\r\n]+\]\s+)?\[clean(?: run=([a-z0-9-]+))?\]\s+(REMOVED|TRASHED|FAILED|SKIPPED)\s+(.+)$/i)
  return match ? { action: match[2].toUpperCase() as CleanOperationRecord['action'], label: match[3].trim(), runId: match[1] ?? null } : null
}

function inspectOperationLog(value: string): {
  records: CleanOperationRecord[]
  footer: SessionMarker | null
  status: CleanExecutionSummary['operationLogStatus']
} {
  const lines = splitLines(value)
  const markers = lines.map(sessionMarker).filter((marker): marker is SessionMarker => marker !== null)
  const entries = lines.map((line, index) => ({ line, index, record: operationRecord(line) }))
    .filter((entry): entry is { line: string, index: number, record: CleanOperationRecord } => entry.record !== null)
  const runIds = new Set([...markers.map((marker) => marker.runId), ...entries.map((entry) => entry.record.runId)].filter(Boolean))
  // The collector cannot yet prove which of concurrent Mole runs owns a global
  // log suffix. Never select an arbitrary last footer or add different runs.
  if (runIds.size > 1) return { records: [], footer: null, status: 'ambiguous' }
  const runId = [...runIds][0] ?? null
  const relevantMarkers = markers.filter((marker) => marker.runId === runId)
  const last = relevantMarkers[relevantMarkers.length - 1]
  let start = 0
  if (runId === null && last) {
    const precedingStart = [...relevantMarkers].reverse().find((marker) => !marker.ended && marker.index <= last.index)
    const previousEnds = relevantMarkers.filter((marker) => marker.ended && marker.index < last.index)
    const previousEnd = previousEnds[previousEnds.length - 1]
    start = precedingStart && (!previousEnd || precedingStart.index > previousEnd.index)
      ? precedingStart.index : (previousEnd?.index ?? -1) + 1
    if (!last.ended) start = last.index
  }
  const end = last?.ended ? last.index : Number.POSITIVE_INFINITY
  const seen = new Set<string>()
  const records = entries.filter((entry) => {
    if (entry.record.runId !== runId || (runId === null && (entry.index < start || entry.index > end)) || seen.has(entry.line)) return false
    // Keep distinct timed events for the same path; only duplicate log records
    // from live/raw/oplog transport are removed. Path text is never a size.
    seen.add(entry.line)
    return true
  }).map((entry) => entry.record)
  return {
    records, footer: last?.ended ? last : null,
    status: records.length || relevantMarkers.length ? 'available' : 'unavailable',
  }
}

export function parseCleanOperationLog(rawOutput: string): CleanOperationRecord[] {
  return inspectOperationLog(rawOutput).records
}
