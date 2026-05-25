import { findLatestProgress } from './cleanProgress'
import type { MoleCleanItem, MoleCleanPreview, MoleCleanSection } from './types'

export interface CleanExecutionSummary {
  itemCount: number
  totalSize: number
}

export function buildExecutedCleanPreview(
  preview: MoleCleanPreview,
  summary: CleanExecutionSummary,
  rawOutput: string,
  options: { confirmedOnly?: boolean; confirmedSectionTitle?: string } = {},
): MoleCleanPreview {
  const sections = buildExecutedSections(preview.sections, summary.itemCount, rawOutput, options)
  return {
    ...preview,
    potential_space: summary.totalSize,
    item_count: summary.itemCount,
    category_count: countExecutedCategories(sections, summary.itemCount),
    sections,
    raw_output: rawOutput,
  }
}

export function summarizeCleanExecution(
  preview: MoleCleanPreview,
  lines: string[],
  rawOutput: string,
  operationLog: string,
  fallbackToPreview: boolean,
): CleanExecutionSummary {
  const allLines = collectLines(lines, rawOutput, operationLog)

  const explicit = parseExplicitSummary(allLines)
  if (explicit) return explicit

  const operationLogSummary = summarizeOperationLog(allLines)
  if (operationLogSummary.itemCount > 0 || operationLogSummary.totalSize > 0) {
    return operationLogSummary
  }

  const progress = findLatestProgress(allLines)
  if (progress?.phase === 'execution' && progress.total !== null && progress.total > 0) {
    const ratio = Math.min(1, Math.max(0, progress.current / progress.total))
    return {
      itemCount: progress.current,
      totalSize: Math.round(preview.potential_space * ratio),
    }
  }

  return fallbackToPreview
    ? { itemCount: preview.item_count, totalSize: preview.potential_space }
    : { itemCount: 0, totalSize: 0 }
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
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]

    const session = line.match(/clean session ended .*?,\s*(\d+)\s+items?,\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\b/i)
    if (session) {
      return {
        itemCount: Number(session[1]),
        totalSize: unitToBytes(Number(session[2]), session[3]),
      }
    }

    const freed = line.match(/Space freed:\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\b(?:\s*\|\s*Items cleaned:\s*(\d+))?/i)
    if (freed) {
      return {
        itemCount: freed[3] ? Number(freed[3]) : 0,
        totalSize: unitToBytes(Number(freed[1]), freed[2]),
      }
    }
  }

  return null
}

function summarizeOperationLog(lines: string[]): CleanExecutionSummary {
  let itemCount = 0
  let totalSize = 0

  for (const line of lines) {
    if (!/\[clean\]\s+(REMOVED|TRASHED)\s+/i.test(line)) continue
    itemCount += 1
    totalSize += parseLineSize(line)
  }

  return { itemCount, totalSize }
}

function parseLineSize(line: string) {
  let size = 0
  const matches = line.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\b/gi)
  for (const match of matches) {
    size = Math.max(size, unitToBytes(Number(match[1]), match[2]))
  }
  return size
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
  sections: MoleCleanSection[],
  itemCount: number,
  rawOutput: string,
  options: { confirmedOnly?: boolean; confirmedSectionTitle?: string },
) {
  if (itemCount <= 0) return []

  if (options.confirmedOnly) {
    const items = parseOperationLogItems(collectLines([], rawOutput, ''))
    return items.length > 0
      ? [{ title: options.confirmedSectionTitle ?? 'Confirmed cleaned items', items }]
      : []
  }

  return sections.filter((section) => section.items.length > 0)
}

function parseOperationLogItems(lines: string[]): MoleCleanItem[] {
  const items: MoleCleanItem[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const match = line.match(/\[clean\]\s+(REMOVED|TRASHED)\s+(.+)$/i)
    if (!match) continue

    const label = match[2].trim()
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)

    const size = parseLineSize(line)
    items.push({
      label,
      size: size > 0 ? size : null,
      count: 1,
      status: 'ok',
    })
  }

  return items
}

function countExecutedCategories(sections: MoleCleanSection[], itemCount: number) {
  if (itemCount <= 0) return 0
  return sections.filter((section) => section.items.length > 0).length
}
