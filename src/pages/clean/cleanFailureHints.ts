const PERMISSION_ERROR_RE =
  /\b(operation not permitted|permission denied|not authorized|access denied|eperm|eacces)\b/i

export function hasDiskAccessFailure(output: string) {
  return PERMISSION_ERROR_RE.test(output)
}

