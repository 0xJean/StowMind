import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { replacePublishedRelease, restorePublishedRelease } from './lib/replace-release.cjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const tagName = 'v1.2.0', dmgName = 'StowMind_1.2.0_universal.dmg'
const requestId = 'c'.repeat(64), prefix = `replacement-${tagName}-${requestId}`
const mutating = new Set(['uploadReleaseAsset', 'updateReleaseAsset', 'updateRelease'])
const oldDmg = Buffer.from('original signed notarized DMG')
const oldChecksum = Buffer.from(`${hash(oldDmg)}  ${dmgName}\n`)
const newDmg = Buffer.from('replacement signed notarized DMG')

function fixture(t, override) {
  const root = mkdtempSync(path.join(tmpdir(), 'stowmind-replacement-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (name, bytes) => { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes) }
  write('package.json', JSON.stringify({ version: '1.2.0' }))
  write('src-tauri/Cargo.toml', '[package]\nname = "stowmind"\nversion = "1.2.0"\n')
  write('src-tauri/Cargo.lock', 'version = 3\n\n[[package]]\nname = "stowmind"\nversion = "1.2.0"\n')
  write('src-tauri/tauri.conf.json', JSON.stringify({ package: { version: '1.2.0' } }))
  write(`.github/release-notes/${tagName}.md`, 'Reviewed fixes for cleanup accuracy and cancellation.\n')
  write(`release-assets/${dmgName}`, newDmg)
  write('release-assets/SHA256SUMS.txt', `${hash(newDmg)}  ${dmgName}\n`)
  const state = { release: { id: 7, tag_name: tagName, draft: false, prerelease: false, immutable: false, body: 'Original published notes', name: 'Original title' },
    assets: [], bytes: new Map(), nextId: 100, tagOid: 'a'.repeat(40), tagCommit: 'd'.repeat(40) }
  const add = (id, name, bytes) => {
    state.assets.push({ id, name, size: bytes.length, digest: `sha256:${hash(bytes)}` })
    state.bytes.set(id, Buffer.from(bytes))
  }
  add(11, dmgName, oldDmg); add(12, 'SHA256SUMS.txt', oldChecksum); add(99, 'unrelated.txt', Buffer.from('leave me alone'))
  const calls = [], errors = []
  const methods = ['getRelease', 'listReleaseAssets', 'getReleaseAsset', 'uploadReleaseAsset', 'updateReleaseAsset', 'updateRelease']
  const repos = Object.fromEntries(methods.map((name) => [name, async (args) => {
    calls.push({ name, args })
    const next = () => {
      if (name === 'getRelease') return { data: structuredClone({ ...state.release, assets: state.assets }) }
      if (name === 'listReleaseAssets') return { data: structuredClone(state.assets) }
      if (name === 'getReleaseAsset') {
        assert.equal(args.headers.accept, 'application/octet-stream')
        if (!state.bytes.has(args.asset_id)) throw new Error('missing asset')
        return { data: Buffer.from(state.bytes.get(args.asset_id)) }
      }
      if (name === 'uploadReleaseAsset') {
        if (state.assets.some((asset) => asset.name === args.name)) throw new Error('duplicate asset name')
        const id = state.nextId++
        add(id, args.name, args.data)
        return { data: structuredClone(state.assets.find((asset) => asset.id === id)) }
      }
      if (name === 'updateReleaseAsset') {
        if (state.assets.some((asset) => asset.name === args.name && asset.id !== args.asset_id)) throw new Error('duplicate rename target')
        const asset = state.assets.find((item) => item.id === args.asset_id)
        if (!asset) throw new Error('missing rename asset')
        asset.name = args.name
        return { data: structuredClone(asset) }
      }
      if (name === 'updateRelease') { state.release.body = args.body; return { data: structuredClone(state.release) } }
      throw new Error(name)
    }
    return override ? override(name, args, next, state) : next()
  }]))
  const github = { rest: { repos, git: {
    getRef: async () => { calls.push({ name: 'getRef' }); return { data: { object: { type: 'tag', sha: state.tagOid } } } },
    getTag: async () => { calls.push({ name: 'getTag' }); return { data: { object: { type: 'commit', sha: state.tagCommit } } } },
  } }, paginate: { iterator: async function* (method, args) { yield await method(args) } } }
  const options = { github, context: { repo: { owner: 'owner', repo: 'repo' }, sha: 'b'.repeat(40) }, core: { error: (message) => errors.push(message) },
    root, backupDir: path.join(root, 'backup'), tagName, sourceSha: 'b'.repeat(40), expectedTagOid: 'a'.repeat(40), expectedReleaseId: 7,
    expectedDmgSha256: hash(oldDmg), expectedChecksumSha256: hash(oldChecksum), requestId,
    reason: 'Repair cleanup accuracy while retaining version 1.2.0', runUrl: 'https://github.com/owner/repo/actions/runs/123',
    notarySubmissionId: '11111111-2222-3333-4444-555555555555' }
  const journalPath = path.join(options.backupDir, 'replacement-journal.json')
  return { root, options, state, add, calls, errors, write, journalPath,
    publish: () => replacePublishedRelease(options), restore: (extra = {}) => restorePublishedRelease({ ...options, runUrl: 'https://github.com/owner/repo/actions/runs/456', ...extra }),
    writes: () => calls.filter((entry) => mutating.has(entry.name)), journal: () => JSON.parse(readFileSync(journalPath, 'utf8')) }
}
function assertOriginal(f) {
  assert.equal(f.state.assets.find((asset) => asset.id === 11).name, dmgName)
  assert.equal(f.state.assets.find((asset) => asset.id === 12).name, 'SHA256SUMS.txt')
  assert.equal(f.state.release.body, 'Original published notes')
  assert.deepEqual(f.state.bytes.get(11), oldDmg)
  assert.deepEqual(f.state.bytes.get(12), oldChecksum)
  assert.equal(f.state.assets.find((asset) => asset.id === 99).name, 'unrelated.txt')
  assert.ok(f.calls.every(({ name }) => !/delete|createRef|updateRef/i.test(name)))
}

test('replacement preserves the original tag and all original bytes with a verified permanent backup and audit', async (t) => {
  const f = fixture(t)
  const value = await f.publish()
  assert.equal(value.status, 'committed')
  assert.equal(f.state.tagOid, f.options.expectedTagOid)
  assert.equal(f.state.tagCommit, 'd'.repeat(40))
  assert.equal(f.state.assets.find((asset) => asset.id === 11).name, `${prefix}-old-${dmgName}`)
  assert.deepEqual(f.state.bytes.get(11), oldDmg)
  const canonical = f.state.assets.find((asset) => asset.name === dmgName)
  assert.equal(hash(f.state.bytes.get(canonical.id)), hash(newDmg))
  assert.ok(value.backupAsset.id && value.auditAsset.id)
  assert.equal(hash(f.state.bytes.get(value.backupAsset.id)), value.backupAsset.sha256)
  const audit = JSON.parse(f.state.bytes.get(value.auditAsset.id))
  assert.equal(audit.journal.request.notarySubmissionId, f.options.notarySubmissionId)
  for (const text of [f.options.sourceSha, f.state.tagCommit, f.options.runUrl, f.options.reason, hash(newDmg), f.options.notarySubmissionId]) assert.ok(f.state.release.body.includes(text))
  const firstRename = f.calls.findIndex((entry) => entry.name === 'updateReleaseAsset')
  assert.ok(f.calls.slice(0, firstRename).some((entry) => entry.name === 'getReleaseAsset' && entry.args.asset_id === value.backupAsset.id))
  assert.equal(f.state.assets.find((asset) => asset.id === 99).name, 'unrelated.txt')
})

for (const [label, alter] of [
  ['immutable public release', (f) => { f.state.release.immutable = true }],
  ['draft release', (f) => { f.state.release.draft = true }],
  ['wrong release ID', (f) => { f.state.release.id = 8 }],
  ['changed tag object', (f) => { f.state.tagOid = 'e'.repeat(40) }],
  ['old DMG metadata drift', (f) => { f.state.assets[0].digest = `sha256:${'0'.repeat(64)}` }],
  ['old DMG content drift', (f) => { f.state.bytes.set(11, Buffer.from('different original image')) }],
  ['old checksum drift', (f) => { f.state.bytes.set(12, Buffer.from('different checksum')) }],
  ['extra local asset', (f) => f.write('release-assets/unverified.zip', 'extra')],
  ['local version mismatch', (f) => f.write('package.json', '{"version":"1.3.0"}')],
  ['wrong local checksum', (f) => f.write('release-assets/SHA256SUMS.txt', 'wrong')],
  ['invalid notary UUID', (f) => { f.options.notarySubmissionId = 'missing' }],
]) {
  test(`${label} refuses before any remote mutation`, async (t) => {
    const f = fixture(t); alter(f)
    await assert.rejects(f.publish())
    assert.deepEqual(f.writes(), [])
  })
}

test('backup verification failure cannot rename the original canonical assets', async (t) => {
  const f = fixture(t, (name, args, next, state) => {
    if (name === 'getReleaseAsset' && state.assets.find((asset) => asset.id === args.asset_id)?.name.endsWith('-backup.tar.gz')) return { data: Buffer.from('corrupt backup response') }
    return next()
  })
  await assert.rejects(f.publish(), /original canonical assets\/notes were restored/)
  assertOriginal(f)
  assert.equal(f.calls.some((entry) => entry.name === 'updateReleaseAsset'), false)
})

for (const stage of [0, 1]) {
  test(`new asset upload ${stage + 1} failure leaves original assets intact`, async (t) => {
    const target = stage === 0 ? dmgName : 'SHA256SUMS.txt'
    const f = fixture(t, (name, args, next) => {
      if (name === 'uploadReleaseAsset' && args.name === `${prefix}-new-${target}`) throw new Error('staging upload failure')
      return next()
    })
    await assert.rejects(f.publish(), /staging upload failure/)
    assertOriginal(f)
    assert.equal(f.calls.some((entry) => entry.name === 'updateReleaseAsset'), false)
  })
}

for (const failedStep of [1, 2, 3, 4]) {
  test(`canonical rename step ${failedStep} failure rolls back only known transaction IDs`, async (t) => {
    let renames = 0
    const f = fixture(t, (name, args, next) => {
      if (name === 'updateReleaseAsset' && ++renames === failedStep) throw new Error(`rename ${failedStep} failed`)
      return next()
    })
    await assert.rejects(f.publish(), /original canonical assets\/notes were restored/)
    assertOriginal(f)
    assert.equal(f.journal().phase, 'rolled_back')
    assert.ok(f.calls.filter((entry) => entry.name === 'updateReleaseAsset').every((entry) => entry.args.asset_id !== 99))
  })
}

for (const operation of ['backup', 'new-dmg', 'new-checksum', 'rename-1', 'rename-2', 'rename-3', 'rename-4', 'notes', 'audit']) {
  test(`${operation} successful mutation with lost response is reconciled by ID and downloaded bytes`, async (t) => {
    let lost = false, renames = 0
    const f = fixture(t, (name, args, next) => {
      if (name === 'updateReleaseAsset') renames += 1
      const matches = (operation === 'backup' && name === 'uploadReleaseAsset' && args.name.endsWith('-backup.tar.gz'))
        || (operation === 'new-dmg' && name === 'uploadReleaseAsset' && args.name === `${prefix}-new-${dmgName}`)
        || (operation === 'new-checksum' && name === 'uploadReleaseAsset' && args.name === `${prefix}-new-SHA256SUMS.txt`)
        || (operation === `rename-${renames}` && name === 'updateReleaseAsset')
        || (operation === 'notes' && name === 'updateRelease')
        || (operation === 'audit' && name === 'uploadReleaseAsset' && args.name.endsWith('-audit.json'))
      const response = next()
      if (matches && !lost) { lost = true; throw new Error('successful response lost') }
      return response
    })
    assert.equal((await f.publish()).status, 'committed')
    assert.equal(lost, true)
    assert.ok(f.journal().events.some((entry) => entry.responseLost === true))
  })
}

test('rollback failure preserves old bytes and a later dedicated recovery restores old names and notes', async (t) => {
  let fail = true, switching = true
  const f = fixture(t, (name, args, next) => {
    if (name === 'updateReleaseAsset' && fail && args.name === 'SHA256SUMS.txt' && args.asset_id !== 12 && switching) { switching = false; throw new Error('new checksum rename denied') }
    if (name === 'updateReleaseAsset' && fail && args.name === dmgName && args.asset_id === 11) throw new Error('rollback rename denied')
    return next()
  })
  await assert.rejects(f.publish(), /Rollback also failed/)
  assert.equal(f.journal().phase, 'recovery_required')
  assert.deepEqual(f.state.bytes.get(11), oldDmg)
  fail = false
  const recovered = await f.restore()
  assertOriginal(f)
  const audit = JSON.parse(f.state.bytes.get(recovered.recoveryAudit.id))
  assert.ok(audit.journal.events.some((entry) => entry.recoveryRun === 'https://github.com/owner/repo/actions/runs/456'))
})

test('a committed transaction can be re-entered without any remote mutation', async (t) => {
  const f = fixture(t)
  const first = await f.publish(); f.calls.length = 0
  const second = await f.publish()
  assert.equal(second.backupAsset.id, first.backupAsset.id)
  assert.deepEqual(f.writes(), [])
})

test('crash after an old asset rename is restored using the durable intent journal', async (t) => {
  let crash, injected = false
  const f = fixture(t, (name, args, next, state) => {
    const response = next()
    if (name === 'updateReleaseAsset' && args.asset_id === 12 && !injected) {
      injected = true
      crash = { assets: structuredClone(state.assets), release: structuredClone(state.release), journal: readFileSync(f.journalPath) }
      throw new Error('lost rename response')
    }
    return response
  })
  await f.publish()
  f.state.assets = crash.assets; f.state.release = crash.release; writeFileSync(f.journalPath, crash.journal)
  await assert.rejects(f.publish(), /Interrupted replacement restored/)
  assertOriginal(f)
})

test('recovery finds a completed staging upload whose ID was not yet persisted', async (t) => {
  let crash, captured = false
  const f = fixture(t, (name, args, next, state) => {
    const response = next()
    if (name === 'uploadReleaseAsset' && args.name === `${prefix}-new-${dmgName}` && !captured) {
      captured = true
      crash = { assets: structuredClone(state.assets), release: structuredClone(state.release), journal: readFileSync(f.journalPath) }
    }
    return response
  })
  await f.publish()
  f.state.assets = crash.assets; f.state.release = crash.release; writeFileSync(f.journalPath, crash.journal)
  const restored = await f.restore()
  assertOriginal(f)
  assert.ok(restored.newAssets[0].id)
  assert.ok(f.journal().events.some((entry) => entry.action === 'recovered-upload'))
})

for (const field of ['sourceSha', 'expectedDmgSha256', 'requestId']) {
  test(`recovery rejects mismatched ${field} without mutating anything`, async (t) => {
    const f = fixture(t); await f.publish(); f.calls.length = 0
    await assert.rejects(f.restore({ [field]: 'f'.repeat(field === 'sourceSha' ? 40 : 64) }), /does not match/)
    assert.deepEqual(f.writes(), [])
  })
}

test('recovery refuses tampered original notes before changing public metadata', async (t) => {
  const f = fixture(t); await f.publish(); f.calls.length = 0
  const journal = f.journal(); journal.originalBody = 'tampered notes'; writeFileSync(f.journalPath, JSON.stringify(journal))
  await assert.rejects(f.restore(), /original release notes are inconsistent/)
  assert.deepEqual(f.writes(), [])
})

test('a foreign canonical asset is preserved and cannot be removed by rollback or recovery', async (t) => {
  let added = false
  const f = fixture(t, (name, args, next, state) => {
    const response = next()
    if (name === 'updateReleaseAsset' && args.asset_id === 11 && !added) {
      added = true
      state.assets.push({ id: 888, name: dmgName, size: 7, digest: `sha256:${hash(Buffer.from('foreign'))}` })
      state.bytes.set(888, Buffer.from('foreign'))
      throw new Error('concurrent asset appeared')
    }
    return response
  })
  await assert.rejects(f.publish(), /Rollback also failed/)
  await assert.rejects(f.restore(), /Unknown canonical asset/)
  assert.equal(f.state.assets.find((asset) => asset.id === 888).name, dmgName)
  assert.deepEqual(f.state.bytes.get(888), Buffer.from('foreign'))
  assert.deepEqual(f.state.bytes.get(11), oldDmg)
  assert.ok(f.calls.filter((entry) => entry.name === 'updateReleaseAsset').every((entry) => entry.args.asset_id !== 888))
})

test('a fresh runner without the recovery journal refuses existing transaction assets', async (t) => {
  const f = fixture(t); await f.publish(); f.calls.length = 0
  f.options.backupDir = path.join(f.root, 'empty-runner')
  await assert.rejects(f.publish(), /restore its recovery journal/)
  assert.deepEqual(f.writes(), [])
})

for (const failure of ['notes', 'audit']) {
  test(`${failure} failure after switching canonical assets restores original notes and names`, async (t) => {
    const f = fixture(t, (name, args, next) => {
      if (failure === 'notes' && name === 'updateRelease' && args.body !== 'Original published notes') throw new Error('notes update denied')
      if (failure === 'audit' && name === 'uploadReleaseAsset' && args.name.endsWith('-audit.json')) throw new Error('audit upload denied')
      return next()
    })
    await assert.rejects(f.publish(), /original canonical assets\/notes were restored/)
    assertOriginal(f)
  })
}

test('a transaction-name collision is preserved and rejected before any mutation', async (t) => {
  const f = fixture(t)
  f.add(555, `${prefix}-new-${dmgName}`, Buffer.from('foreign staging bytes'))
  await assert.rejects(f.publish(), /Existing transaction assets/)
  assert.deepEqual(f.writes(), [])
  assert.deepEqual(f.state.bytes.get(555), Buffer.from('foreign staging bytes'))
})

test('recovery refuses journal original metadata tampering by checking the permanent archive', async (t) => {
  const f = fixture(t); await f.publish(); f.calls.length = 0
  const journal = f.journal()
  journal.originalBody = 'altered original notes'; journal.originalRelease.body = journal.originalBody
  writeFileSync(f.journalPath, JSON.stringify(journal))
  await assert.rejects(f.restore(), /permanent backup metadata/)
  assert.deepEqual(f.writes(), [])
})

test('recovery cannot mutate canonical names when the permanent backup bytes are corrupt', async (t) => {
  const f = fixture(t); const completed = await f.publish(); f.calls.length = 0
  f.state.bytes.set(completed.backupAsset.id, Buffer.from('corrupt permanent backup'))
  await assert.rejects(f.restore(), /bytes do not match/)
  assert.deepEqual(f.writes(), [])
})

test('recovery rejects unknown asset IDs in the journal before mutation', async (t) => {
  const f = fixture(t); await f.publish(); f.calls.length = 0
  const journal = f.journal(); journal.oldAssets[0].id = 99; writeFileSync(f.journalPath, JSON.stringify(journal))
  await assert.rejects(f.restore(), /replacement notes|Old asset ID/)
  assert.deepEqual(f.writes(), [])
  assert.equal(f.state.assets.find((asset) => asset.id === 99).name, 'unrelated.txt')
})

test('backup upload failure with intact originals only journals a local no-op, without a remote audit', async (t) => {
  const f = fixture(t, (name, args, next) => {
    if (name === 'uploadReleaseAsset' && args.name.endsWith('-backup.tar.gz')) throw new Error('backup upload denied')
    return next()
  })
  await assert.rejects(f.publish(), /backup upload denied/)
  assertOriginal(f)
  assert.deepEqual(f.writes().map(({ name }) => name), ['uploadReleaseAsset'])
  f.calls.length = 0
  const recovered = await f.restore()
  assert.equal(recovered.status, 'unchanged')
  assert.equal(recovered.recoveryAudit, null)
  assert.deepEqual(f.writes(), [])
  assert.ok(f.journal().events.some((entry) => entry.action === 'rollback-unnecessary'))
})
