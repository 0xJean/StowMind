import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runNotarization } from './lib/notarization.mjs'

const submissionId = '8a184d26-2a72-47c2-91ca-532670716fc3'
const fakeKey = '-----BEGIN PRIVATE KEY-----\nTEST_ONLY_NOT_A_REAL_PRIVATE_KEY\n-----END PRIVATE KEY-----'
const jsonResult = (value, status = 0) => ({ status, stdout: JSON.stringify(value), stderr: '' })
const operation = (command, args) => command === 'xcrun' ? args.slice(0, 2).join(' ') : command

function fixture(t, override) {
  const directory = mkdtempSync(path.join(tmpdir(), 'stowmind-notary-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const dmgPath = path.join(directory, 'StowMind test image.dmg')
  writeFileSync(dmgPath, 'mock disk image')
  const env = {
    RUNNER_TEMP: directory,
    APPLE_API_KEY: fakeKey,
    APPLE_API_KEY_ID: 'TESTKEY1234',
    APPLE_API_ISSUER: 'fbe716be-6d21-49bf-a118-9e0380f89a58',
  }
  const calls = []
  const output = []
  const keyPaths = new Set()
  const run = (command, args, options) => {
    calls.push({ command, args, options })
    assert.equal(options?.shell === true, false, 'commands must not interpolate credentials into a shell')
    assert.equal(Object.keys(options.env).some((name) => name.startsWith('APPLE_')), false, 'child tools must not inherit raw Apple secrets')
    assert.equal(args.some((argument) => String(argument).includes(fakeKey)), false)
    const keyIndex = args.indexOf('--key')
    if (keyIndex >= 0) {
      const keyPath = args[keyIndex + 1]
      keyPaths.add(keyPath)
      assert.equal(readFileSync(keyPath, 'utf8').trim(), fakeKey)
      assert.equal(statSync(keyPath).mode & 0o777, 0o600)
      assert.equal(statSync(path.dirname(keyPath)).mode & 0o777, 0o700)
    }
    const fallback = () => {
      if (operation(command, args) === 'notarytool history') return jsonResult({ history: [] })
      if (operation(command, args) === 'notarytool submit') return jsonResult({ id: submissionId, message: 'Successfully uploaded file' })
      if (operation(command, args) === 'notarytool wait') return jsonResult({ id: submissionId, status: 'Accepted' })
      if (operation(command, args) === 'notarytool log') return jsonResult({
        jobId: submissionId, status: 'Invalid', issues: [{ severity: 'error', path: 'StowMind.app', message: 'The binary is not signed with a valid Developer ID certificate.' }],
      })
      return { status: 0, stdout: 'accepted\nsource=Notarized Developer ID', stderr: '' }
    }
    return override ? override(command, args, fallback) : fallback()
  }
  return {
    env, dmgPath, calls, output, keyPaths,
    execute(mode = 'notarize', envOverride = {}) {
      const result = runNotarization({
        mode, dmgPath, env: { ...env, ...envOverride }, run,
        log: (value) => output.push(String(value)), error: (value) => output.push(String(value)),
      })
      for (const keyPath of keyPaths) {
        assert.equal(existsSync(keyPath), false, 'temporary private keys must be removed on every return path')
        assert.equal(existsSync(path.dirname(keyPath)), false, 'temporary credential directories must be removed')
      }
      assert.equal(output.join('\n').includes(fakeKey), false)
      return result
    },
    operations() { return calls.map(({ command, args }) => operation(command, args)) },
  }
}

test('preflight reads notarization history without uploading or stapling and cleans its private key', (t) => {
  const runner = fixture(t)
  assert.equal(runner.execute('preflight'), 0)
  assert.deepEqual(runner.operations(), ['notarytool history'])
  assert.equal(runner.keyPaths.size, 1)
  const args = runner.calls[0].args
  assert.equal(args[args.indexOf('--output-format') + 1], 'json')
})

test('agreement HTTP 403 fails the read-only preflight with Account Holder guidance', (t) => {
  const runner = fixture(t, (_command, _args) => ({
    status: 1, stdout: '',
    stderr: 'Error: HTTP status code: 403. A required agreement is missing or has expired.',
  }))
  assert.equal(runner.execute('preflight'), 1)
  assert.deepEqual(runner.operations(), ['notarytool history'])
  assert.match(runner.output.join('\n'), /Account Holder/i)
  assert.match(runner.output.join('\n'), /agreement/i)
})

test('an ordinary permission HTTP 403 is not mislabeled as an expired Apple agreement', (t) => {
  const runner = fixture(t, () => ({ status: 1, stdout: '', stderr: 'Error: HTTP status code: 403. Access to this resource is forbidden for this role.' }))
  assert.equal(runner.execute('preflight'), 1)
  assert.deepEqual(runner.operations(), ['notarytool history'])
  assert.match(runner.output.join('\n'), /403/)
  assert.doesNotMatch(runner.output.join('\n'), /Account Holder|expired agreement/i)
})

test('a successful tool exit without valid history JSON cannot pass preflight', (t) => {
  const runner = fixture(t, () => ({ status: 0, stdout: 'unexpected response', stderr: '' }))
  assert.equal(runner.execute('preflight'), 1)
  assert.deepEqual(runner.operations(), ['notarytool history'])
})

test('accepted submission records its ID before waiting and completes every distribution gate in order', (t) => {
  let runner
  runner = fixture(t, (command, args, fallback) => {
    if (operation(command, args) === 'notarytool wait') {
      assert.match(runner.output.join('\n'), new RegExp(submissionId), 'record the upload ID before the potentially long wait')
    }
    return fallback()
  })
  assert.equal(runner.execute(), 0)
  assert.deepEqual(runner.operations(), [
    'notarytool submit', 'notarytool wait', 'stapler staple', 'stapler validate', 'spctl',
  ])
  const submit = runner.calls[0].args
  assert.equal(submit.includes('--no-wait'), true)
  assert.equal(submit.includes(runner.dmgPath), true, 'paths containing spaces remain a single argument')
  const wait = runner.calls[1].args
  assert.equal(wait.includes(submissionId), true)
  assert.equal(wait[wait.indexOf('--timeout') + 1], '30m')
  const gatekeeper = runner.calls.at(-1).args
  assert.equal(gatekeeper.includes('context:primary-signature'), true)
})

for (const status of ['Invalid', 'Rejected', 'In Progress']) {
  test(`a zero-exit ${status} response still prevents stapling and fetches the submission diagnostic`, (t) => {
    const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool wait'
      ? jsonResult({ id: submissionId, status })
      : fallback())
    assert.equal(runner.execute(), 1)
    assert.deepEqual(runner.operations(), ['notarytool submit', 'notarytool wait', 'notarytool log'])
    assert.equal(runner.calls.at(-1).args.includes(submissionId), true)
  })
}

test('a nonzero wait exit cannot be accepted even if its JSON status says Accepted', (t) => {
  const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool wait'
    ? jsonResult({ id: submissionId, status: 'Accepted' }, 1)
    : fallback())
  assert.equal(runner.execute(), 1)
  assert.deepEqual(runner.operations(), ['notarytool submit', 'notarytool wait', 'notarytool log'])
})

for (const id of [undefined, '7c30a810-5599-46f5-92e0-dfb23cf51170']) {
  test(`Accepted must belong to the submitted archive (${id ?? 'missing ID'})`, (t) => {
    const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool wait'
      ? jsonResult({ id, status: 'Accepted' })
      : fallback())
    assert.equal(runner.execute(), 1)
    assert.deepEqual(runner.operations(), ['notarytool submit', 'notarytool wait', 'notarytool log'])
    assert.equal(runner.calls.at(-1).args.includes(submissionId), true, 'diagnostics must refer to the original upload')
  })
}

test('a failed upload with a known ID records and retrieves diagnostics without starting a wait', (t) => {
  const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool submit'
    ? jsonResult({ id: submissionId, message: 'Upload failed' }, 1)
    : fallback())
  assert.equal(runner.execute(), 1)
  assert.deepEqual(runner.operations(), ['notarytool submit', 'notarytool log'])
  assert.match(runner.output.join('\n'), new RegExp(submissionId))
})

for (const result of [{ message: 'no ID' }, { id: 'untrusted-command-text' }]) {
  test(`an upload without a valid submission UUID fails closed (${JSON.stringify(result)})`, (t) => {
    const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool submit'
      ? jsonResult(result)
      : fallback())
    assert.equal(runner.execute(), 1)
    assert.deepEqual(runner.operations(), ['notarytool submit'])
  })
}

test('malformed wait output cannot authorize stapling', (t) => {
  const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool wait'
    ? { status: 0, stdout: 'not JSON', stderr: '' }
    : fallback())
  assert.equal(runner.execute(), 1)
  assert.deepEqual(runner.operations(), ['notarytool submit', 'notarytool wait', 'notarytool log'])
})

test('a process timeout retrieves the known submission diagnostic and prevents stapling', (t) => {
  const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool wait'
    ? { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync xcrun ETIMEDOUT'), { code: 'ETIMEDOUT' }) }
    : fallback())
  assert.equal(runner.execute(), 1)
  assert.deepEqual(runner.operations(), ['notarytool submit', 'notarytool wait', 'notarytool log'])
  assert.match(runner.output.join('\n'), /ETIMEDOUT|timeout/i)
})

test('a nonzero notarytool wait timeout fails even when the response contains a submission ID', (t) => {
  const runner = fixture(t, (command, args, fallback) => operation(command, args) === 'notarytool wait'
    ? { ...jsonResult({ id: submissionId, status: 'In Progress' }, 124), stderr: 'Timed out waiting for processing to complete.' }
    : fallback())
  assert.equal(runner.execute(), 1)
  assert.deepEqual(runner.operations(), ['notarytool submit', 'notarytool wait', 'notarytool log'])
  assert.match(runner.output.join('\n'), /Timed out|timeout/i)
})

for (const failingGate of ['stapler staple', 'stapler validate', 'spctl']) {
  test(`${failingGate} failure prevents a successful release result`, (t) => {
    const runner = fixture(t, (command, args, fallback) => operation(command, args) === failingGate
      ? { status: 1, stdout: '', stderr: 'Distribution gate rejected the disk image' }
      : fallback())
    assert.equal(runner.execute(), 1)
    const sequence = ['notarytool submit', 'notarytool wait', 'stapler staple', 'stapler validate', 'spctl']
    assert.deepEqual(runner.operations(), sequence.slice(0, sequence.indexOf(failingGate) + 1))
  })
}

for (const missing of ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
  test(`missing ${missing} prevents any tool invocation`, (t) => {
    const runner = fixture(t)
    assert.equal(runner.execute('preflight', { [missing]: '' }), 1)
    assert.deepEqual(runner.calls, [])
  })
}

test('tool spawn failure fails closed and removes the temporary key', (t) => {
  const runner = fixture(t, () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn xcrun ENOENT') }))
  assert.equal(runner.execute('preflight'), 1)
  assert.deepEqual(runner.operations(), ['notarytool history'])
  assert.match(runner.output.join('\n'), /ENOENT|spawn|failed/i)
})

test('a thrown runner error fails closed and still removes the temporary key', (t) => {
  const runner = fixture(t, () => { throw new Error('runner unexpectedly threw') })
  assert.equal(runner.execute('preflight'), 1)
  assert.deepEqual(runner.operations(), ['notarytool history'])
})

test('diagnostics never expose key contents, raw credential values, or signed download URLs', (t) => {
  const runner = fixture(t, (command, args, fallback) => {
    if (operation(command, args) === 'notarytool wait') return jsonResult({ id: submissionId, status: 'Invalid' })
    if (operation(command, args) === 'notarytool log') return jsonResult({
      jobId: submissionId, status: 'Invalid',
      logFileUrl: 'https://example.invalid/private?X-Amz-Signature=private-signature',
      issues: [{ severity: 'error', path: 'StowMind.app', message: `${fakeKey}\nTESTKEY1234\nfbe716be-6d21-49bf-a118-9e0380f89a58\nhttps://example.invalid/file?token=private-signature` }],
    })
    return fallback()
  })
  assert.equal(runner.execute(), 1)
  const text = runner.output.join('\n')
  for (const privateValue of [fakeKey, 'TEST_ONLY_NOT_A_REAL_PRIVATE_KEY', 'TESTKEY1234', runner.env.APPLE_API_ISSUER, 'private-signature', 'https://example.invalid']) {
    assert.equal(text.includes(privateValue), false, `diagnostics must omit ${privateValue.slice(0, 20)}`)
  }
})

test('the release workflow keeps preflight before build and publication after notarization', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/publish.yml', import.meta.url)), 'utf8')
  const credentialCheck = workflow.indexOf('name: require macOS release credentials')
  const preflight = workflow.indexOf('node scripts/notarize-macos.mjs preflight')
  const build = workflow.indexOf('name: build universal macOS app')
  const notarization = workflow.indexOf('node scripts/notarize-macos.mjs notarize')
  const cleanup = workflow.indexOf('name: clean temporary release credentials')
  const collection = workflow.indexOf('name: collect release assets')
  const publication = workflow.indexOf('name: publish GitHub release')
  assert.ok(credentialCheck >= 0 && preflight > credentialCheck && build > preflight)
  assert.ok(notarization > build && cleanup > notarization && collection > cleanup && publication > collection)
  assert.match(workflow.slice(cleanup, collection), /if: always\(\)/)
  const collectedAssets = workflow.slice(collection, publication)
  assert.match(collectedAssets, /dmg_name="StowMind_\$\{version\}_universal\.dmg"/)
  assert.equal(collectedAssets.includes('.app.tar.gz'), false, 'only the notarized DMG and its checksum may be distributed')
  assert.match(workflow, /environment: production-release/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.equal(workflow.includes('continue-on-error: true'), false)
  for (const [, revision] of workflow.matchAll(/\buses:\s+[^@\s]+@([^\s]+)/g)) assert.match(revision, /^[a-f0-9]{40}$/)
})

function releaseWorkflowStep(name) {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/publish.yml', import.meta.url)), 'utf8')
  const steps = workflow.split(/^      - name: /m)
  const step = steps.find((value) => value.startsWith(`${name}\n`))
  assert.ok(step, `Expected workflow step: ${name}`)
  return step
}

test('Apple credentials remain scoped to the steps that require them', () => {
  const required = releaseWorkflowStep('require macOS release credentials')
  assert.equal(required.includes('GITHUB_ENV'), false, 'credential presence checks cannot persist secrets for later actions')
  const build = releaseWorkflowStep('build universal macOS app')
  for (const name of ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_TEAM_ID']) {
    assert.ok(build.includes(`${name}:`), `build needs its own ${name} environment binding`)
  }
  assert.equal(build.includes('APPLE_API_KEY'), false)
  for (const name of ['preflight Apple notarization access', 'notarize and staple macOS disk image']) {
    const step = releaseWorkflowStep(name)
    assert.ok(step.includes('APPLE_API_KEY:'))
    assert.ok(step.includes('APPLE_API_KEY_ID:'))
    assert.ok(step.includes('APPLE_API_ISSUER:'))
    assert.equal(step.includes('APPLE_CERTIFICATE:'), false)
  }
  for (const name of ['install Rust stable', 'Rust cache', 'install frontend dependencies', 'collect release assets', 'publish GitHub release']) {
    assert.equal(/secrets\.APPLE_/.test(releaseWorkflowStep(name)), false, `${name} must not receive Apple credentials`)
  }
})

function runCleanupFixture(t, { securityExit = 0, linkedKeyDirectory = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'stowmind-cleanup-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bin = path.join(root, 'mock-bin')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'security'), `#!/bin/sh\nexit ${securityExit}\n`, { mode: 0o755 })
  const p12 = path.join(root, 'stowmind-release-ci.p12')
  const keychain = path.join(root, 'stowmind-signing.keychain-db')
  writeFileSync(p12, 'mock encrypted certificate')
  writeFileSync(keychain, 'mock keychain')
  const keyDirectory = path.join(root, 'stowmind-notary-fixture')
  const actualKeyDirectory = linkedKeyDirectory ? path.join(root, 'outside-allowed-key-directories') : keyDirectory
  mkdirSync(actualKeyDirectory)
  const key = path.join(actualKeyDirectory, 'AuthKey.p8')
  writeFileSync(key, 'fake private key', { mode: 0o600 })
  if (linkedKeyDirectory) symlinkSync(actualKeyDirectory, keyDirectory, 'dir')
  const block = releaseWorkflowStep('clean temporary release credentials')
  const source = block.split('        run: |\n')[1].split('\n').map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n')
  const result = spawnSync('bash', ['-c', source], {
    encoding: 'utf8', env: { RUNNER_TEMP: root, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin` },
  })
  return { result, p12, keychain, key, keyDirectory }
}

test('a failed keychain deletion still removes temporary P12 and API keys and fails the cleanup gate', (t) => {
  const cleanup = runCleanupFixture(t, { securityExit: 1 })
  assert.equal(cleanup.result.status, 1)
  assert.match(cleanup.result.stdout, /Could not delete the temporary signing keychain/)
  assert.equal(existsSync(cleanup.p12), false)
  assert.equal(existsSync(cleanup.key), false)
  assert.equal(existsSync(cleanup.keyDirectory), false)
  const collection = releaseWorkflowStep('collect release assets')
  const publication = releaseWorkflowStep('publish GitHub release')
  assert.equal(/if:\s*always\(\)/.test(collection + publication), false, 'cleanup failure must prevent collection and publication')
})

test('credential cleanup rejects a symbolic-link key directory and preserves its target', (t) => {
  const cleanup = runCleanupFixture(t, { linkedKeyDirectory: true })
  assert.equal(cleanup.result.status, 1)
  assert.match(cleanup.result.stdout, /Unexpected symbolic link/)
  assert.equal(existsSync(cleanup.key), true, 'cleanup must not follow a key-directory symlink')
  assert.equal(existsSync(cleanup.p12), false)
})
