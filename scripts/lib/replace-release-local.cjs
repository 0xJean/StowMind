const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const journalName = 'replacement-journal.json'

async function validateLocal(options) {
  const { validateReleaseManifest } = await import('../check-release-manifest.mjs')
  const { tagName, sourceSha, expectedTagOid, expectedReleaseId, expectedDmgSha256,
    expectedChecksumSha256, reason, runUrl, requestId, notarySubmissionId, context } = options
  for (const [name, value] of Object.entries({ sourceSha, expectedTagOid })) {
    if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error(`${name} must be a full Git SHA.`)
  }
  for (const [name, value] of Object.entries({ requestId, expectedDmgSha256, expectedChecksumSha256 })) {
    if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw new Error(`${name} must be a SHA256 digest.`)
  }
  if (!Number.isSafeInteger(expectedReleaseId) || expectedReleaseId <= 0) throw new Error('An exact release ID is required.')
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 4000) throw new Error('A specific replacement reason is required.')
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(notarySubmissionId ?? '')) throw new Error('A valid notarization submission UUID is required.')
  const run = new URL(runUrl)
  const server = new URL(context.serverUrl ?? 'https://github.com')
  if (run.protocol !== 'https:' || run.origin !== server.origin || !run.pathname.startsWith(`/${context.repo.owner}/${context.repo.repo}/actions/runs/`) || !/^\d+$/.test(run.pathname.split('/').at(-1)) || run.search || run.hash) throw new Error('An exact repository Actions run URL is required.')
  const root = path.resolve(options.root ?? process.cwd())
  const backupDir = path.resolve(options.backupDir ?? '')
  if (!options.backupDir || backupDir === path.join(root, 'release-assets') || backupDir.startsWith(`${path.join(root, 'release-assets')}${path.sep}`)) throw new Error('A separate backupDir is required.')
  const version = validateReleaseManifest({ tag: tagName, root })
  const names = [`StowMind_${version}_universal.dmg`, 'SHA256SUMS.txt']
  const assetDir = path.join(root, 'release-assets')
  if (JSON.stringify(fs.readdirSync(assetDir).sort()) !== JSON.stringify([...names].sort())) throw new Error('Replacement assets must contain exactly the versioned universal DMG and SHA256SUMS.txt.')
  const files = names.map((name) => {
    const file = path.join(assetDir, name), stat = fs.lstatSync(file)
    if (!stat.isFile() || !stat.size) throw new Error(`Expected a nonempty regular replacement asset: ${name}`)
    const bytes = fs.readFileSync(file)
    return { name, bytes, sha256: sha256(bytes), size: bytes.length }
  })
  if (files[1].bytes.toString('utf8').trim() !== `${files[0].sha256}  ${names[0]}`) throw new Error('Replacement checksum does not match the exact DMG.')
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  if (!fs.lstatSync(backupDir).isDirectory() || fs.lstatSync(backupDir).isSymbolicLink()) throw new Error('backupDir must be a real directory.')
  return { root, backupDir, files, prefix: `replacement-${tagName}-${requestId}`, notes: fs.readFileSync(path.join(root, '.github', 'release-notes', `${tagName}.md`), 'utf8') }
}

function saveJournal(directory, journal) {
  const target = path.join(directory, journalName)
  const temporary = `${target}.${randomUUID()}.tmp`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, target)
}

function loadJournal(directory) {
  const file = path.join(directory, journalName)
  if (!fs.existsSync(file)) return null
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Recovery journal must be a regular file.')
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (journal.schema !== 1 || !Array.isArray(journal.events)) throw new Error('Unsupported recovery journal; manual recovery is required.')
  return journal
}

function event(directory, journal, action, detail = {}) {
  journal.events.push({ at: new Date().toISOString(), action, ...detail })
  saveJournal(directory, journal)
}

function makeBackup(local, journal, oldBytes) {
  const payload = path.join(local.backupDir, 'original')
  fs.mkdirSync(payload, { recursive: true, mode: 0o700 })
  for (let index = 0; index < journal.oldAssets.length; index += 1) fs.writeFileSync(path.join(payload, journal.oldAssets[index].canonical), oldBytes[index], { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(path.join(payload, 'metadata.json'), `${JSON.stringify({ release: journal.originalRelease, tag: journal.originalTag, request: journal.request, oldAssets: journal.oldAssets, newAssets: journal.newAssets, releaseNotes: journal.releaseNotes }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(path.join(payload, journalName), `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  const file = path.join(local.backupDir, journal.backup.name)
  const result = spawnSync('tar', ['-czf', file, '-C', payload, '.'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`Unable to create permanent backup archive: ${result.error?.message ?? result.stderr}`)
  const bytes = fs.readFileSync(file)
  return { bytes, sha256: sha256(bytes), size: bytes.length }
}

function replacementNotes(journal) {
  const value = journal.request
  return `${journal.releaseNotes.trim()}\n\n## Same-version asset replacement\n\n` +
    `- Request: \`${value.requestId}\`\n- Reason: ${value.reason.trim()}\n` +
    `- Original tag object (unchanged): \`${value.expectedTagOid}\`\n- Original tag commit (unchanged): \`${journal.originalTag.commit}\`\n` +
    `- Replacement source commit: \`${value.sourceSha}\`\n- Verified build run: ${value.runUrl}\n- Apple notarization submission: \`${value.notarySubmissionId}\`\n` +
    `- Permanent original-assets backup: \`${journal.backup.name}\` (asset ID ${journal.backup.id}, SHA256 \`${journal.backup.sha256}\`)\n` +
    journal.oldAssets.map((asset) => `- Original \`${asset.canonical}\`: SHA256 \`${asset.sha256}\`, retained as \`${asset.backupName}\` (asset ID ${asset.id})\n`).join('') +
    journal.newAssets.map((asset) => `- Replacement \`${asset.canonical}\`: SHA256 \`${asset.sha256}\` (asset ID ${asset.id})\n`).join('') +
    `- Audit: \`replacement-${value.tagName}-${value.requestId}-audit.json\`\n\n` +
    'The version tag still identifies the original commit. The replacement binaries were built from the explicit replacement source commit above.\n'
}


module.exports = { sha256, validateLocal, saveJournal, loadJournal, event, makeBackup, replacementNotes }
