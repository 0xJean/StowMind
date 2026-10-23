import type { MoleCleanItem, MoleCleanPreview } from './types'

export interface CleanExecutionSummary {
  itemCount: number | null
  totalSize: number | null
}

export function buildExecutedCleanPreview(
  preview: MoleCleanPreview,
  summary: CleanExecutionSummary,
  rawOutput: string,
  options: { confirmedSectionTitle?: string } = {},
): MoleCleanPreview {
  const sections = buildExecutedSections(summary.itemCount, rawOutput, options.confirmedSectionTitle)
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
  const allLines = collectLines(lines, rawOutput, operationLog)

  const explicit = parseExplicitSummary(allLines)
  if (explicit) return explicit

  const operationLogSummary = summarizeOperationLog(allLines)
  if ((operationLogSummary.itemCount ?? 0) > 0) {
    return operationLogSummary
  }
  // Scan estimates and progress ratios are not evidence of bytes actually freed.
  return { itemCount: null, totalSize: null }
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
  const marker = 'Mole operation log:'
  const index = value.indexOf(marker)
  if (index < 0) return { rawOutput: value, operationLog: '' }
  return {
    rawOutput: value.slice(0, index).trimEnd(),
    operationLog: value.slice(index + marker.length).trim(),
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
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function parseExplicitSummary(lines: string[]): CleanExecutionSummary | null {
  let reportedCount: number | null = null
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]

    const session = line.match(/^#\s*=+\s*clean(?: run=[a-z0-9-]+)? session ended at .*?,\s*(\d+)\s+items?,\s*[0-9]+(?:\.[0-9]+)?\s*[KMGT]?B\s*=+$/i)
    if (session) {
      reportedCount ??= Number(session[1])
      continue
    }

    const tracked = line.match(/^Tracked cleanup:.*\|\s*Items cleaned:\s*(\d+)\s*$/i)
    if (tracked) reportedCount ??= Number(tracked[1])
    // Anchoring excludes estimates and filenames containing "Space freed:".
    const freed = line.match(/^Space freed:\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\b(?:\s*\|\s*Items cleaned:\s*(\d+))?/i)
    if (freed) {
      return {
        itemCount: freed[3] ? Number(freed[3]) : reportedCount,
        totalSize: unitToBytes(Number(freed[1]), freed[2]),
      }
    }
  }

  return reportedCount === null ? null : { itemCount: reportedCount, totalSize: null }
}

function summarizeOperationLog(lines: string[]): CleanExecutionSummary {
  let itemCount = 0
  const seen = new Set<string>()

  for (const line of lines) {
    if (!confirmedOperation(line)) continue
    if (seen.has(line)) continue
    seen.add(line)
    itemCount += 1
  }

  return { itemCount: itemCount || null, totalSize: null }
}

function unitToBytes(amount: number, unit: string) {
  const normalized = unit.toUpperCase()
  const multiplier = normalized === 'KB'
    ? 1024
    : normalized === 'MB'
      ? 1024 ** 2
      : normalized === 'GB'
        ? 1024 ** 3
        : normalized === 'TB'
          ? 1024 ** 4
          : 1
  return Math.round(amount * multiplier)
}

function buildExecutedSections(
  itemCount: number | null,
  rawOutput: string,
  confirmedSectionTitle?: string,
) {
  if (itemCount === null || itemCount <= 0) return []

  const items = parseOperationLogItems(collectLines([], rawOutput, ''))
  return items.length > 0
    ? [{ title: confirmedSectionTitle ?? 'Confirmed cleaned items', items }]
    : []
}

function parseOperationLogItems(lines: string[]): MoleCleanItem[] {
  const items: MoleCleanItem[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const label = confirmedOperation(line)
    if (!label) continue
    const key = label
    if (!label || seen.has(key)) continue
    seen.add(key)

    items.push({
      label,
      // A filename may contain a size-looking string; log paths are not byte reports.
      size: null,
      count: 1,
      status: 'ok',
    })
  }

  return items
}

function confirmedOperation(line: string) {
  return line.match(/^(?:\[[^\]\r\n]+\]\s+)?\[clean(?: run=[a-z0-9-]+)?\]\s+(?:REMOVED|TRASHED)\s+(.+)$/i)?.[1].trim() ?? null
}
