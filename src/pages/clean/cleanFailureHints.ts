const PERMISSION_ERROR_RE =
  /\b(operation not permitted|permission denied|not authorized|access denied|eperm|eacces)\b/i

export function hasDiskAccessFailure(output: string) {
  return PERMISSION_ERROR_RE.test(output)
}

export function getCleanFailureLines(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function getCleanFailureSummary(output: string) {
  return getCleanFailureLines(output)[0] ?? output.trim()
}

export function getCleanFailureDetails(output: string) {
  return getCleanFailureLines(output).slice(1).join('\n')
}

export type CleanFailureKind = 'runtime_limit' | 'idle_limit' | 'permission' | 'unknown'

export function getCleanFailureKind(output: string): {
  kind: CleanFailureKind
  seconds?: number
} {
  const summary = getCleanFailureSummary(output)
  const runtimeMatch = summary.match(/exceeded\s+(\d+)s\s+runtime/i)
  if (runtimeMatch) {
    return { kind: 'runtime_limit', seconds: Number(runtimeMatch[1]) }
  }

  const idleMatch = summary.match(/no output for\s+(\d+)s/i)
  if (idleMatch) {
    return { kind: 'idle_limit', seconds: Number(idleMatch[1]) }
  }

  if (hasDiskAccessFailure(output)) {
    return { kind: 'permission' }
  }

  return { kind: 'unknown' }
}
