const SPINNER_PREFIX_RE = /^[|/\\\-]\s+/
const PROGRESS_RATIO_RE = /^(.+?)\s+(\d+)\s*\/\s*(\d+)\s*\.{0,3}$/
const PROGRESS_COUNT_RE = /^(.+?)\s+(\d+)\s+(?:items?|files?|paths?|entries|things)?\s*\.{0,4}$/i

/**
 * Mole runs cleanup in two phases:
 *  - 'discovery': enumerating what can be cleaned (count rises, total unknown)
 *  - 'execution': actually deleting (current/total ratio is known)
 * Verbs in the output reveal which phase we're in.
 */
const DISCOVERY_VERBS = /\b(scan|search|find|discover|enumerate|count|list|index|collect|inspect|analyz|check)/i
const EXECUTION_VERBS = /\b(clean|remov|delet|purg|trash|empty|free|reclai|wip|eras)/i

export type CleanPhase = 'discovery' | 'execution' | 'unknown'

export interface CleanProgress {
  verb: string
  current: number
  total: number | null
  percent: number | null
  phase: CleanPhase
}

export function stripSpinner(line: string) {
  return line.replace(SPINNER_PREFIX_RE, '').trim()
}

function detectPhase(verb: string): CleanPhase {
  if (EXECUTION_VERBS.test(verb)) return 'execution'
  if (DISCOVERY_VERBS.test(verb)) return 'discovery'
  return 'unknown'
}

export function parseCleanProgress(line: string): CleanProgress | null {
  const stripped = stripSpinner(line)

  const ratioMatch = stripped.match(PROGRESS_RATIO_RE)
  if (ratioMatch) {
    const current = Number(ratioMatch[2])
    const total = Number(ratioMatch[3])
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
      const verb = ratioMatch[1].trim()
      return {
        verb,
        current,
        total,
        percent: Math.min(100, Math.max(0, Math.round((current / total) * 100))),
        phase: detectPhase(verb),
      }
    }
  }

  const countMatch = stripped.match(PROGRESS_COUNT_RE)
  if (countMatch) {
    const current = Number(countMatch[2])
    if (Number.isFinite(current)) {
      const verb = countMatch[1].trim()
      return {
        verb,
        current,
        total: null,
        percent: null,
        phase: detectPhase(verb),
      }
    }
  }

  return null
}

export function findLatestProgress(lines: string[]): CleanProgress | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const p = parseCleanProgress(lines[i])
    if (p) return p
  }
  return null
}

/**
 * Find the latest meaningful "step" line (non-spinner, non-progress, non-noise).
 * Used to show what mole is currently working on (a category header, a path, etc.)
 */
const STEP_NOISE_RE = [
  /^clean your mac/i,
  /^use\s+--/i,
  /^usage:/i,
  /^stowmind/i,
  /^---+$/,
  /^={3,}$/,
  /^[~`*•·]+$/,
]

export function findLatestStep(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const stripped = stripSpinner(lines[i])
    if (!stripped) continue
    if (stripped.startsWith('[stderr]')) continue
    if (parseCleanProgress(stripped)) continue
    if (STEP_NOISE_RE.some((re) => re.test(stripped))) continue
    return stripped
  }
  return null
}

/**
 * Collapse consecutive lines that differ only in their spinner prefix.
 * `| Scanning items... 7/331` and `/ Scanning items... 7/331` collapse to one entry.
 */
export function dedupeSpinnerLines(lines: string[]): string[] {
  const result: string[] = []
  let prevStripped: string | null = null
  for (const line of lines) {
    const stripped = stripSpinner(line)
    if (stripped === prevStripped) continue
    result.push(stripped)
    prevStripped = stripped
  }
  return result
}
