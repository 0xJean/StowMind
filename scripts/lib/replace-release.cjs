// This entry point is only for the protected CI workflow after signature,
// notarization, stapling and independent verification of release-assets.
// Git tags and release/asset bytes are never deleted or overwritten here.
const fs = require('node:fs')
const path = require('node:path')
const { validateLocal, loadJournal, event, makeBackup, replacementNotes } = require('./replace-release-local.cjs')
const { ReplacementRemote } = require('./replace-release-remote.cjs')
const { assertJournal, verifyBackup, rollback, uploadAudit } = require('./replace-release-recovery.cjs')

function request(options) {
  return { owner: options.context.repo.owner, repo: options.context.repo.repo, tagName: options.tagName,
    sourceSha: options.sourceSha, expectedTagOid: options.expectedTagOid, expectedReleaseId: options.expectedReleaseId,
    expectedDmgSha256: options.expectedDmgSha256, expectedChecksumSha256: options.expectedChecksumSha256,
    requestId: options.requestId, reason: options.reason, runUrl: options.runUrl, notarySubmissionId: options.notarySubmissionId }
}


function result(journal) {
  return { status: journal.phase, releaseId: journal.request.expectedReleaseId, requestId: journal.request.requestId,
    originalTagCommit: journal.originalTag.commit, sourceSha: journal.request.sourceSha,
    backupAsset: journal.backup, auditAsset: journal.audit, oldAssets: journal.oldAssets, newAssets: journal.newAssets }
}

async function verifyCommitted(remote) {
  await remote.tag()
  const release = await remote.release()
  if ((release.body ?? '') !== remote.journal.replacementBody) throw new Error('Completed transaction notes changed; manual review is required.')
  await verifyBackup(remote)
  for (const asset of remote.journal.oldAssets) await remote.verify(asset, [asset.backupName])
  for (const asset of remote.journal.newAssets) await remote.verify(asset, [asset.canonical])
  if (!remote.journal.audit) throw new Error('Completed transaction has no verified audit asset.')
  await remote.verify(remote.journal.audit, [remote.journal.audit.name])
}

async function replacePublishedRelease(options) {
  const core = options.core ?? console
  const local = await validateLocal(options)
  let journal = loadJournal(local.backupDir)
  const remote = new ReplacementRemote(options, local, journal)
  if (journal) {
    assertJournal(options, journal)
    if (journal.phase === 'committed') { await verifyCommitted(remote); return result(journal) }
    await restorePublishedRelease(options)
    throw new Error('Interrupted replacement restored to the original assets. Review the recovery audit and authorize a fresh request before another replacement.')
  }
  if (fs.readdirSync(local.backupDir).length) throw new Error('Backup directory is not empty and has no journal; manual recovery is required.')
  const originalTag = await remote.tag()
  const originalRelease = await remote.release()
  const assets = await remote.assets()
  if (assets.some((asset) => asset.name.startsWith(`${local.prefix}-`))) throw new Error(`Existing transaction assets for ${options.requestId}; restore its recovery journal before retrying. No assets were changed.`)
  const oldHashes = [options.expectedDmgSha256, options.expectedChecksumSha256]
  const oldAssets = local.files.map((file, index) => {
    const matches = assets.filter((asset) => asset.name === file.name)
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || !Number.isSafeInteger(matches[0].size) || matches[0].size <= 0) throw new Error(`Original canonical asset ${file.name} is missing or ambiguous; recovery may be required.`)
    return { id: matches[0].id, canonical: file.name, backupName: `${local.prefix}-old-${file.name}`, sha256: oldHashes[index], size: matches[0].size }
  })
  const oldBytes = []
  for (const spec of oldAssets) oldBytes.push((await remote.verify(spec, [spec.canonical])).bytes)
  if (oldBytes[1].toString('utf8').trim() !== `${options.expectedDmgSha256}  ${oldAssets[0].canonical}`) throw new Error('Original checksum contents do not identify the expected original DMG.')
  journal = {
    schema: 1, phase: 'prepared', request: request(options), originalTag,
    originalRelease: { ...originalRelease, assets }, originalBody: originalRelease.body ?? '', releaseNotes: local.notes, replacementBody: null,
    oldAssets, newAssets: local.files.map((file) => ({ id: null, canonical: file.name, name: `${local.prefix}-new-${file.name}`, sha256: file.sha256, size: file.size })),
    backup: { id: null, name: `${local.prefix}-backup.tar.gz`, sha256: null, size: null }, audit: null, events: [],
  }
  remote.journal = journal
  event(local.backupDir, journal, 'prepared')
  try {
    const archive = makeBackup(local, journal, oldBytes)
    Object.assign(journal.backup, { sha256: archive.sha256, size: archive.size })
    remote.record('backup-created', { name: journal.backup.name, sha256: archive.sha256 })
    await remote.upload(journal.backup, archive.bytes)
    await verifyBackup(remote)
    for (let index = 0; index < 2; index += 1) await remote.upload(journal.newAssets[index], local.files[index].bytes)
    journal.replacementBody = replacementNotes(journal)
    journal.phase = 'switching'
    remote.record('canonical-switch-prepared')
    await remote.tag()
    // All bytes and the permanent backup are verified before freeing either name.
    for (const asset of journal.oldAssets) await remote.rename(asset, asset.backupName, [asset.canonical, asset.backupName])
    for (const asset of journal.newAssets) await remote.rename(asset, asset.canonical, [asset.name, asset.canonical])
    await remote.body(journal.replacementBody, [journal.originalBody, journal.replacementBody])
    await remote.tag()
    for (const asset of journal.newAssets) await remote.verify(asset, [asset.canonical])
    journal.phase = 'verified'
    remote.record('replacement-verified')
    journal.audit = await uploadAudit(remote, 'replacement-verified')
    journal.phase = 'committed'
    remote.record('committed')
    return result(journal)
  } catch (cause) {
    try {
      remote.record('replacement-failed', { message: cause.message })
      const recovered = await rollback(remote)
      if (recovered.backupVerified) {
        try { await uploadAudit(remote, 'rolled-back') } catch (auditError) { core.error(`Rollback completed; permanent rollback audit upload failed: ${auditError.message}. Preserve ${local.backupDir}.`) }
      }
    } catch (rollbackError) {
      journal.phase = 'recovery_required'
      try { remote.record('rollback-failed', { message: rollbackError.message }) } catch { /* Preserve the previous durable journal. */ }
      throw new Error(`Replacement failed: ${cause.message}. Rollback also failed: ${rollbackError.message}. Preserve ${local.backupDir} and use the recovery workflow; no asset bytes were deleted.`, { cause })
    }
    throw new Error(`Replacement failed and original canonical assets/notes were restored: ${cause.message}`, { cause })
  }
}

async function restorePublishedRelease(options) {
  const core = options.core ?? console
  if (!options.backupDir) throw new Error('Recovery backupDir is required.')
  const backupDir = path.resolve(options.backupDir)
  if (!fs.lstatSync(backupDir).isDirectory() || fs.lstatSync(backupDir).isSymbolicLink()) throw new Error('Recovery backupDir must be a real directory.')
  const journal = loadJournal(backupDir)
  if (!journal) throw new Error('Recovery requires the original transaction journal; no asset was changed.')
  assertJournal(options, journal)
  const local = { backupDir, prefix: `replacement-${options.tagName}-${options.requestId}` }
  const remote = new ReplacementRemote(options, local, journal)
  try {
    remote.record('recovery-requested', { recoveryRun: options.runUrl, controlSha: options.controlSha })
    const recovered = await rollback(remote)
    if (!recovered.backupVerified) return { ...result(journal), status: 'unchanged', recoveryAudit: null }
    const audit = await uploadAudit(remote, 'restored')
    remote.record('recovery-audit-verified', { id: audit.id, name: audit.name, sha256: audit.sha256, recoveryRun: options.runUrl })
    return { ...result(journal), recoveryAudit: audit }
  } catch (cause) {
    core.error(`Recovery did not finish: ${cause.message}. Preserve ${backupDir}; no asset bytes were deleted.`)
    throw cause
  }
}

module.exports = { replacePublishedRelease, restorePublishedRelease }
