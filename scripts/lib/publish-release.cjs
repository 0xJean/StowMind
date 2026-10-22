const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

async function publishRelease({ github, context, core = console, tagName, root = process.cwd() }) {
  const { validateReleaseManifest } = await import('../check-release-manifest.mjs')
  const version = validateReleaseManifest({ tag: tagName, root })
  const assetDir = path.join(root, 'release-assets')
  const dmgName = `StowMind_${version}_universal.dmg`
  const files = [dmgName, 'SHA256SUMS.txt']
  const actualFiles = fs.readdirSync(assetDir).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify([...files].sort())) {
    throw new Error('Release assets must contain only the versioned universal DMG and SHA256SUMS.txt.')
  }
  for (const name of files) {
    const file = fs.lstatSync(path.join(assetDir, name))
    if (!file.isFile() || file.size === 0) throw new Error(`Expected a nonempty regular release asset: ${name}`)
  }
  const checksum = createHash('sha256').update(fs.readFileSync(path.join(assetDir, dmgName))).digest('hex')
  if (fs.readFileSync(path.join(assetDir, 'SHA256SUMS.txt'), 'utf8').trim() !== `${checksum}  ${dmgName}`) {
    throw new Error('The release checksum must match the exact versioned DMG.')
  }
  const releaseBody = fs.readFileSync(path.join(root, '.github', 'release-notes', `${tagName}.md`), 'utf8')
  const repo = { owner: context.repo.owner, repo: context.repo.repo }
  const api = github.rest.repos
  let release
  let created = false
  // Listing with push permissions includes drafts; lookup-by-tag only promises
  // published releases and could miss a resumable draft on a previous attempt.
  for await (const response of github.paginate.iterator(api.listReleases, { ...repo, per_page: 100 })) {
    release = response.data.find((item) => item.tag_name === tagName)
    if (release) break
  }
  if (release && !release.draft) {
    throw new Error('Refusing to replace an already published release. Use a new version tag.')
  }

  try {
    if (!release) {
      release = (await api.createRelease({
        ...repo, tag_name: tagName, name: `StowMind ${tagName}`,
        body: releaseBody, draft: true, prerelease: false,
      })).data
      created = true
    }
    // Only drafts can be resumed. Published assets are never removed or replaced.
    for (const asset of release.assets ?? []) await api.deleteReleaseAsset({ ...repo, asset_id: asset.id })
    for (const fileName of files) {
      const data = fs.readFileSync(path.join(assetDir, fileName))
      await api.uploadReleaseAsset({
        ...repo, release_id: release.id, name: fileName,
        headers: { 'content-type': 'application/octet-stream', 'content-length': data.length }, data,
      })
    }
    return (await api.updateRelease({
      ...repo, release_id: release.id, name: `StowMind ${tagName}`, body: releaseBody,
      draft: false, prerelease: false, make_latest: 'true',
    })).data
  } catch (cause) {
    if (release) {
      try {
        // Publishing may have succeeded even if the response was lost. Re-read
        // before cleanup so an ambiguous network error never deletes a public release.
        const current = (await api.getRelease({ ...repo, release_id: release.id })).data
        if (current.draft) {
          if (created) await api.deleteRelease({ ...repo, release_id: release.id })
          else for (const asset of current.assets ?? []) await api.deleteReleaseAsset({ ...repo, asset_id: asset.id })
        } else {
          core.error('Release publication returned an error after the release became public; verify it before retrying. Published assets were preserved.')
        }
      } catch {
        core.error('Draft release cleanup failed. Inspect the draft and remove partial assets before retrying.')
      }
    }
    throw cause
  }
}

module.exports = { publishRelease }
