const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { sha256, replacementNotes } = require('./replace-release-local.cjs')

function assertJournal(options, journal) {
  const expected = { owner: options.context.repo.owner, repo: options.context.repo.repo, tagName: options.tagName,
    sourceSha: options.sourceSha, expectedTagOid: options.expectedTagOid, expectedReleaseId: options.expectedReleaseId,
    expectedDmgSha256: options.expectedDmgSha256, expectedChecksumSha256: options.expectedChecksumSha256, requestId: options.requestId }
  for (const [key, value] of Object.entries(expected)) if (value == null || journal.request?.[key] !== value) throw new Error(`Recovery journal ${key} does not match the authorized request.`)
  if (!/^v\d+\.\d+\.\d+$/.test(options.tagName) || !/^[a-f0-9]{64}$/.test(options.requestId)) throw new Error('Invalid recovery request identity.')
  const prefix = `replacement-${options.tagName}-${options.requestId}`
  const names = [`StowMind_${options.tagName.slice(1)}_universal.dmg`, 'SHA256SUMS.txt']
  if (journal.oldAssets?.length !== 2 || journal.newAssets?.length !== 2 || journal.originalRelease?.id !== options.expectedReleaseId || journal.originalRelease.tag_name !== options.tagName) throw new Error('Recovery journal release/asset metadata is incomplete.')
  if (journal.originalTag?.ref?.object?.sha !== options.expectedTagOid || !/^[a-f0-9]{40}$/.test(journal.originalTag?.commit ?? '')) throw new Error('Recovery original tag metadata is inconsistent.')
  if (journal.originalBody !== (journal.originalRelease.body ?? '') || typeof journal.releaseNotes !== 'string') throw new Error('Recovery original release notes are inconsistent.')
  if (journal.replacementBody !== null && journal.replacementBody !== replacementNotes(journal)) throw new Error('Recovery replacement notes do not match the transaction.')
  const expectedHashes = [options.expectedDmgSha256, options.expectedChecksumSha256]
  for (let index = 0; index < 2; index += 1) {
    const old = journal.oldAssets[index], fresh = journal.newAssets[index]
    if (old.canonical !== names[index] || old.backupName !== `${prefix}-old-${names[index]}` || old.sha256 !== expectedHashes[index] || !Number.isSafeInteger(old.id) || old.id <= 0) throw new Error('Recovery journal old asset identity is invalid.')
    const original = journal.originalRelease.assets.filter((asset) => asset.id === old.id && asset.name === old.canonical)
    if (original.length !== 1 || original[0].size !== old.size) throw new Error('Old asset ID does not match the initial release metadata.')
    if (fresh.canonical !== names[index] || fresh.name !== `${prefix}-new-${names[index]}` || !/^[a-f0-9]{64}$/.test(fresh.sha256) || !Number.isSafeInteger(fresh.size) || fresh.size <= 0) throw new Error('Recovery journal new asset identity is invalid.')
  }
  if (journal.backup?.name !== `${prefix}-backup.tar.gz`) throw new Error('Recovery archive identity is invalid.')
  const ids = [...journal.oldAssets, ...journal.newAssets, journal.backup].map((asset) => asset.id).filter((id) => id != null)
  if (new Set(ids).size !== ids.length) throw new Error('Recovery asset IDs must be distinct.')
}

async function discoverUpload(remote, spec) {
  if (spec.id) return
  const intended = remote.journal.events.some((entry) => entry.action === 'upload-intent' && entry.name === spec.name && entry.sha256 === spec.sha256)
  if (!intended) return
  const found = (await remote.assets()).filter((asset) => asset.name === spec.name)
  if (!found.length) return
  if (found.length !== 1) throw new Error(`Ambiguous interrupted upload ${spec.name}.`)
  await remote.verify({ ...spec, id: found[0].id }, [spec.name])
  spec.id = found[0].id
  remote.record('recovered-upload', { id: spec.id, name: spec.name, sha256: spec.sha256 })
}

async function verifyBackup(remote) {
  const journal = remote.journal
  await discoverUpload(remote, journal.backup)
  if (!journal.backup.id) throw new Error('Verified permanent backup is unavailable; manual recovery is required.')
  const { bytes } = await remote.verify(journal.backup, [journal.backup.name])
  const file = path.join(remote.local.backupDir, journal.backup.name)
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw new Error('Recovery archive path is not a regular file.')
  fs.writeFileSync(file, bytes, { mode: 0o600 })
  const result = spawnSync('tar', ['-xOzf', file, './metadata.json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Unable to read verified backup metadata.')
  const metadata = JSON.parse(result.stdout)
  const shape = (assets) => assets.map(({ canonical, name, sha256: digest, size }) => ({ canonical, name, digest, size }))
  if (JSON.stringify(metadata.tag) !== JSON.stringify(journal.originalTag) || metadata.releaseNotes !== journal.releaseNotes || JSON.stringify(metadata.request) !== JSON.stringify(journal.request) || JSON.stringify(metadata.oldAssets) !== JSON.stringify(journal.oldAssets)
    || JSON.stringify(metadata.release) !== JSON.stringify(journal.originalRelease) || JSON.stringify(shape(metadata.newAssets)) !== JSON.stringify(shape(journal.newAssets))) throw new Error('Journal does not match the permanent backup metadata.')
  for (const asset of journal.oldAssets) {
    const restored = spawnSync('tar', ['-xOzf', file, `./${asset.canonical}`], { maxBuffer: asset.size + 1024 })
    if (restored.error || restored.status !== 0 || restored.stdout.length !== asset.size || sha256(restored.stdout) !== asset.sha256) throw new Error(`Permanent backup cannot restore the original bytes of ${asset.canonical}.`)
  }
}

async function rollback(remote) {
  const journal = remote.journal
  assertJournal(remote.options, journal)
  await remote.tag()
  const release = await remote.release()
  for (const spec of journal.newAssets) await discoverUpload(remote, spec)
  const current = await remote.assets()
  const knownIds = new Set([...journal.oldAssets, ...journal.newAssets].map((asset) => asset.id))
  for (const name of journal.oldAssets.map((asset) => asset.canonical)) {
    if (current.filter((asset) => asset.name === name).length > 1) throw new Error(`Ambiguous canonical asset ${name}; manual recovery is required.`)
    if (current.some((asset) => asset.name === name && !knownIds.has(asset.id))) throw new Error(`Unknown canonical asset ${name}; no foreign asset will be changed.`)
  }
  if (![journal.originalBody, journal.replacementBody].includes(release.body ?? '')) throw new Error('Third-party release notes changed; manual recovery is required.')
  // Verify every identity before the first rollback mutation.
  for (const spec of journal.oldAssets) await remote.verify(spec, [spec.canonical, spec.backupName])
  for (const spec of journal.newAssets.filter((asset) => asset.id)) await remote.verify(spec, [spec.canonical, spec.name])
  const needsMutation = (release.body ?? '') !== journal.originalBody
    || journal.oldAssets.some((spec) => current.find((asset) => asset.id === spec.id)?.name !== spec.canonical)
    || journal.newAssets.some((spec) => spec.id && current.find((asset) => asset.id === spec.id)?.name !== spec.name)
  try { await verifyBackup(remote) } catch (cause) {
    if (needsMutation) throw cause
    // Original bytes, names and notes are already intact. No remote operation,
    // including an audit upload, is allowed without a bound permanent backup.
    journal.phase = 'rolled_back'
    remote.record('rollback-unnecessary', { backupVerified: false, message: cause.message })
    return { backupVerified: false }
  }
  remote.record('rollback-started')
  for (const spec of journal.newAssets.filter((asset) => asset.id)) await remote.rename(spec, spec.name, [spec.name, spec.canonical])
  for (const spec of journal.oldAssets) await remote.rename(spec, spec.canonical, [spec.canonical, spec.backupName])
  await remote.body(journal.originalBody, [journal.originalBody, journal.replacementBody])
  await remote.tag()
  journal.phase = 'rolled_back'
  remote.record('rollback-complete')
  return { backupVerified: true }
}

async function uploadAudit(remote, outcome) {
  const document = { schema: 1, outcome, recordedAt: new Date().toISOString(), journal: remote.journal }
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`)
  const digest = sha256(bytes)
  const name = `${remote.local.prefix}-${outcome === 'replacement-verified' ? 'audit' : `recovery-${digest.slice(0, 16)}`}.json`
  const spec = { name, sha256: digest, size: bytes.length, id: null }
  fs.writeFileSync(path.join(remote.local.backupDir, name), bytes, { flag: 'wx', mode: 0o600 })
  await remote.upload(spec, bytes)
  return spec
}

module.exports = { assertJournal, discoverUpload, verifyBackup, rollback, uploadAudit }
