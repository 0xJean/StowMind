import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const credentialNames = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
const submissionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseJson(value) {
  try { return JSON.parse(String(value)) } catch { return null }
}

function redact(value, env) {
  let text = String(value ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  for (const name of credentialNames) {
    const secret = env[name]
    if (!secret) continue
    text = text.split(secret).join('[redacted]')
    for (const line of secret.split(/\r?\n/)) {
      if (line.length > 16 && !line.startsWith('-----')) text = text.split(line).join('[redacted]')
    }
  }
  return text.slice(0, 2400)
}

export function runNotarization({
  mode, dmgPath, env = process.env, run = spawnSync, log = console.log, error = console.error,
}) {
  const fail = (message) => error(`::error::${redact(message, env)}`)
  if (!['preflight', 'notarize'].includes(mode)) {
    fail('Expected preflight or notarize mode.')
    return 1
  }
  const missing = credentialNames.filter((name) => !env[name]?.trim())
  if (missing.length) {
    fail(`Missing notarization credentials: ${missing.join(', ')}`)
    return 1
  }
  if (mode === 'notarize' && (!dmgPath || !dmgPath.endsWith('.dmg') || !existsSync(dmgPath))) {
    fail('A built DMG is required for notarization.')
    return 1
  }

  let keyDirectory
  try {
    keyDirectory = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'stowmind-notary-'))
    chmodSync(keyDirectory, 0o700)
    const keyPath = join(keyDirectory, 'AuthKey.p8')
    writeFileSync(keyPath, `${env.APPLE_API_KEY.trim()}\n`, { mode: 0o600, flag: 'wx' })
    const credentials = ['--key', keyPath, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER]
    const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('APPLE_')))
    const execute = (command, args, timeout = 120_000) => {
      try {
        return run(command, args, { encoding: 'utf8', env: childEnv, maxBuffer: 8 * 1024 * 1024, timeout })
      } catch (cause) {
        return { status: null, error: cause, stdout: '', stderr: '' }
      }
    }
    const notary = (verb, args = [], timeout) => execute('xcrun', ['notarytool', verb, ...args, ...credentials, '--output-format', 'json'], timeout)
    const reportFailure = (phase, result) => {
      const detail = [result.stderr, result.error?.message, result.stdout].filter(Boolean).join('\n')
      if (/agreement.*(missing|expired|not.*signed)|required agreement/i.test(detail)) {
        fail('Apple Notary Service requires an active agreement. The Apple Developer Account Holder must review and accept pending or expired agreements at developer.apple.com/account. Publishing is stopped; do not bypass notarization.')
      } else {
        fail(`${phase} failed${result.status === null ? '' : ` (exit ${result.status})`}. ${detail || 'No diagnostic was returned.'}`)
      }
    }
    const showSubmissionLog = (id) => {
      const result = notary('log', [id])
      if (result.status !== 0) {
        reportFailure('Fetching the notarization log', result)
        return
      }
      const diagnostic = parseJson(result.stdout)
      const issues = Array.isArray(diagnostic?.issues) ? diagnostic.issues : []
      if (!issues.length) {
        log(`Notary submission ${id}: no completed issue details are available yet.`)
        return
      }
      // Print only the relevant issue fields, never the complete response or
      // presigned log/download URLs returned by Apple's service.
      for (const issue of issues.slice(0, 20)) {
        error(redact(`Notary issue: ${issue.severity ?? 'unknown'} ${issue.code ?? ''} ${issue.path ?? ''}: ${issue.message ?? ''}`, env))
      }
    }

    if (mode === 'preflight') {
      const result = notary('history')
      if (result.status !== 0 || !Array.isArray(parseJson(result.stdout)?.history)) {
        reportFailure('Apple Notary Service read-only preflight', result)
        return 1
      }
      log('Apple Notary Service read-only preflight passed. No archive was submitted.')
      return 0
    }

    const submission = notary('submit', [dmgPath, '--no-wait'], 600_000)
    const id = parseJson(submission.stdout)?.id
    if (typeof id === 'string' && submissionIdPattern.test(id)) log(`Notary submission ID: ${id}`)
    if (submission.status !== 0 || typeof id !== 'string' || !submissionIdPattern.test(id)) {
      reportFailure('Submitting the DMG for notarization', submission)
      if (typeof id === 'string' && submissionIdPattern.test(id)) showSubmissionLog(id)
      return 1
    }

    const completion = notary('wait', [id, '--timeout', '30m'], 31 * 60_000)
    const completed = parseJson(completion.stdout)
    const status = completed?.status
    if (completion.status !== 0 || status !== 'Accepted' || completed?.id !== id) {
      reportFailure(`Notary submission ${id} (${status ?? 'unknown status'})`, completion)
      showSubmissionLog(id)
      return 1
    }
    log(`Notary submission ${id}: Accepted.`)

    for (const [command, args] of [
      ['xcrun', ['stapler', 'staple', dmgPath]],
      ['xcrun', ['stapler', 'validate', dmgPath]],
      ['spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-vv', dmgPath]],
    ]) {
      const result = execute(command, args)
      if (result.status !== 0) {
        reportFailure(`${command} ${args[0]}`, result)
        return 1
      }
      log(redact([result.stdout, result.stderr].filter(Boolean).join('\n'), env))
    }
    log('Notarization, stapling, ticket validation, and Gatekeeper verification passed.')
    return 0
  } catch (cause) {
    fail(`Notarization could not complete: ${cause.message}`)
    return 1
  } finally {
    if (keyDirectory) rmSync(keyDirectory, { recursive: true, force: true })
  }
}
