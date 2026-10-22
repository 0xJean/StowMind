import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { publishRelease } from './lib/publish-release.cjs'

const version = '1.2.0'
const tagName = `v${version}`
const dmgName = `StowMind_${version}_universal.dmg`
const readMethods = new Set(['listReleases', 'getRelease'])

function fixture(t, { initial = null, releasePage = 1, override } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'stowmind-publish-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (relativePath, source) => {
    const target = path.join(root, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, source)
  }
  write('package.json', JSON.stringify({ version }))
  write('src-tauri/Cargo.toml', `[package]\nname = "stowmind"\nversion = "${version}"\n`)
  write('src-tauri/Cargo.lock', `version = 3\n\n[[package]]\nname = "stowmind"\nversion = "${version}"\n`)
  write('src-tauri/tauri.conf.json', JSON.stringify({ package: { version } }))
  write(`.github/release-notes/${tagName}.md`, 'Validated release feature and compatibility notes.\n')
  const dmg = Buffer.from('mock notarized image bytes')
  const checksum = createHash('sha256').update(dmg).digest('hex')
  write(`release-assets/${dmgName}`, dmg)
  write('release-assets/SHA256SUMS.txt', `${checksum}  ${dmgName}\n`)
  const state = { release: initial ? { tag_name: tagName, ...structuredClone(initial) } : null, nextAssetId: 100 }
  const calls = []
  const errors = []
  const methods = ['listReleases', 'createRelease', 'deleteReleaseAsset', 'uploadReleaseAsset', 'updateRelease', 'getRelease', 'deleteRelease']
  const repos = Object.fromEntries(methods.map((name) => [name, async (args) => {
    calls.push({ name, args })
    const fallback = () => {
      if (name === 'createRelease') {
        state.release = { id: 7, draft: true, prerelease: false, assets: [], tag_name: args.tag_name }
      }
      if (name === 'deleteReleaseAsset') state.release.assets = state.release.assets.filter(({ id }) => id !== args.asset_id)
      if (name === 'uploadReleaseAsset') {
        const asset = { id: state.nextAssetId++, name: args.name }
        state.release.assets.push(asset)
        return { data: asset }
      }
      if (name === 'updateRelease') Object.assign(state.release, { draft: args.draft, prerelease: args.prerelease })
      if (name === 'deleteRelease') state.release = null
      return { data: structuredClone(state.release) }
    }
    return override ? override(name, args, fallback, state) : fallback()
  }]))
  const github = {
    rest: { repos },
    paginate: { iterator: async function* (method, args) {
      assert.equal(method, repos.listReleases)
      for (let page = 1; page <= releasePage; page += 1) {
        calls.push({ name: 'listReleases', args: { ...args, page } })
        yield { data: page === releasePage
          ? (state.release ? [structuredClone(state.release)] : [])
          : [{ id: 80 + page, tag_name: `v0.0.${page}`, draft: false, assets: [] }] }
      }
    } },
  }
  return {
    root, write, state, calls, errors,
    publish: () => publishRelease({
      github, context: { repo: { owner: 'test-owner', repo: 'test-repo' } },
      core: { error: (message) => errors.push(message) }, tagName, root,
    }),
    writes: () => calls.filter(({ name }) => !readMethods.has(name)),
  }
}

test('new releases upload exactly two assets into a draft before publishing as latest', async (t) => {
  const release = fixture(t)
  const result = await release.publish()
  assert.equal(result.draft, false)
  assert.equal(result.prerelease, false)
  assert.deepEqual(release.calls.map(({ name }) => name), ['listReleases', 'createRelease', 'uploadReleaseAsset', 'uploadReleaseAsset', 'updateRelease'])
  const create = release.calls.find(({ name }) => name === 'createRelease').args
  assert.equal(create.draft, true)
  assert.equal(create.tag_name, tagName)
  assert.deepEqual(release.calls.filter(({ name }) => name === 'uploadReleaseAsset').map(({ args }) => args.name), [dmgName, 'SHA256SUMS.txt'])
  const publish = release.calls.at(-1).args
  assert.equal(publish.draft, false)
  assert.equal(publish.make_latest, 'true')
  assert.deepEqual(release.errors, [])
})

test('an already published release and its assets are never replaced', async (t) => {
  const initial = { id: 7, draft: false, assets: [{ id: 5, name: 'public-existing.dmg' }] }
  const release = fixture(t, { initial })
  await assert.rejects(release.publish(), /already published/i)
  assert.deepEqual(release.writes(), [])
  assert.deepEqual(release.state.release, { tag_name: tagName, ...initial })
})

test('an existing draft found on a later page is resumed without creating a duplicate release', async (t) => {
  const release = fixture(t, { initial: { id: 7, draft: true, assets: [] }, releasePage: 2 })
  const result = await release.publish()
  assert.equal(result.id, 7)
  assert.equal(result.draft, false)
  assert.equal(release.calls.filter(({ name }) => name === 'listReleases').length, 2)
  assert.equal(release.calls.some(({ name }) => name === 'createRelease'), false)
  assert.deepEqual(release.calls.filter(({ name }) => name === 'uploadReleaseAsset').map(({ args }) => args.release_id), [7, 7])
})

for (const [name, alter] of [
  ['extra assets', (release) => release.write('release-assets/unverified.app.tar.gz', 'unverified image')],
  ['incorrect SHA256', (release) => release.write('release-assets/SHA256SUMS.txt', `${'0'.repeat(64)}  ${dmgName}\n`)],
  ['version mismatch', (release) => release.write('package.json', JSON.stringify({ version: '1.1.0' }))],
  ['an empty DMG', (release) => release.write(`release-assets/${dmgName}`, '')],
]) {
  test(`${name} fails validation before any GitHub API call`, async (t) => {
    const release = fixture(t)
    alter(release)
    await assert.rejects(release.publish())
    assert.deepEqual(release.calls, [])
  })
}

test('a second upload failure deletes a newly created draft and rethrows the upload error', async (t) => {
  const primary = new Error('second upload failed')
  let uploads = 0
  const release = fixture(t, { override: (name, _args, fallback) => {
    if (name === 'uploadReleaseAsset' && ++uploads === 2) throw primary
    return fallback()
  } })
  await assert.rejects(release.publish(), (cause) => cause === primary)
  assert.deepEqual(release.calls.slice(-2).map(({ name }) => name), ['getRelease', 'deleteRelease'])
  assert.equal(release.state.release, null)
})

test('failure while resuming an existing draft removes partial assets but preserves the draft', async (t) => {
  const primary = new Error('checksum upload failed')
  let uploads = 0
  const release = fixture(t, {
    initial: { id: 7, draft: true, assets: [{ id: 5, name: 'stale-partial.dmg' }] },
    override: (name, _args, fallback) => {
      if (name === 'uploadReleaseAsset' && ++uploads === 2) throw primary
      return fallback()
    },
  })
  await assert.rejects(release.publish(), (cause) => cause === primary)
  assert.equal(release.calls.some(({ name }) => name === 'deleteRelease'), false)
  assert.deepEqual(release.calls.filter(({ name }) => name === 'deleteReleaseAsset').map(({ args }) => args.asset_id), [5, 100])
  assert.equal(release.state.release.draft, true)
  assert.deepEqual(release.state.release.assets, [])
})

test('a lost publication response cannot delete a release that became public', async (t) => {
  const primary = new Error('response lost after publish')
  const release = fixture(t, { override: (name, _args, fallback, state) => {
    if (name === 'updateRelease') {
      state.release.draft = false
      throw primary
    }
    return fallback()
  } })
  await assert.rejects(release.publish(), (cause) => cause === primary)
  assert.equal(release.state.release.draft, false)
  assert.equal(release.state.release.assets.length, 2)
  assert.equal(release.calls.some(({ name }) => name === 'deleteRelease' || name === 'deleteReleaseAsset'), false)
  assert.match(release.errors.join('\n'), /public|preserved/i)
})

test('cleanup failure is reported without swallowing the original upload error', async (t) => {
  const primary = new Error('primary upload error')
  const release = fixture(t, { override: (name, _args, fallback) => {
    if (name === 'uploadReleaseAsset') throw primary
    if (name === 'deleteRelease') throw new Error('cleanup request failed')
    return fallback()
  } })
  await assert.rejects(release.publish(), (cause) => cause === primary)
  assert.match(release.errors.join('\n'), /cleanup failed/i)
  assert.equal(release.state.release.draft, true)
})

test('a failed release creation does not upload files or attempt to remove another release', async (t) => {
  const primary = new Error('creation request denied')
  const release = fixture(t, { override: (name, _args, fallback) => {
    if (name === 'createRelease') throw primary
    return fallback()
  } })
  await assert.rejects(release.publish(), (cause) => cause === primary)
  assert.deepEqual(release.calls.map(({ name }) => name), ['listReleases', 'createRelease'])
  assert.equal(release.state.release, null)
})
