import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { validateReleaseManifest } from './check-release-manifest.mjs'

const version = '1.2.0'
const tag = `v${version}`

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'stowmind-release-manifest-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (relativePath, source) => {
    const target = path.join(root, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, source)
  }
  write('package.json', JSON.stringify({ name: 'stowmind', version }))
  write('src-tauri/Cargo.toml', `[package]\nname = "stowmind"\nversion = "${version}"\nedition = "2021"\n`)
  write('src-tauri/Cargo.lock', `version = 3\n\n[[package]]\nname = "stowmind"\nversion = "${version}"\n\n[[package]]\nname = "unrelated-library"\nversion = "99.0.0"\n`)
  write('src-tauri/tauri.conf.json', JSON.stringify({ package: { productName: 'StowMind', version } }))
  write(`.github/release-notes/${tag}.md`, 'New user-facing functionality and compatibility notes.\n')
  return { root, write, validate: (candidate = tag) => validateReleaseManifest({ tag: candidate, root }) }
}

test('a stable tag matching all four version sources and nonempty release notes is accepted', (t) => {
  const release = fixture(t)
  assert.equal(release.validate(), version)
})

const mismatches = [
  ['package.json', JSON.stringify({ name: 'stowmind', version: '1.1.0' })],
  ['src-tauri/Cargo.toml', '[package]\nname = "stowmind"\nversion = "1.1.0"\n'],
  ['src-tauri/Cargo.lock', 'version = 3\n\n[[package]]\nname = "stowmind"\nversion = "1.1.0"\n'],
  ['src-tauri/tauri.conf.json', JSON.stringify({ package: { version: '1.1.0' } })],
]

for (const [file, content] of mismatches) {
  test(`a version mismatch in ${file} prevents releasing the tag`, (t) => {
    const release = fixture(t)
    release.write(file, content)
    assert.throws(() => release.validate())
  })
}

test('missing release notes prevent release', (t) => {
  const release = fixture(t)
  rmSync(path.join(release.root, `.github/release-notes/${tag}.md`))
  assert.throws(() => release.validate())
})

test('empty release notes prevent release', (t) => {
  const release = fixture(t)
  release.write(`.github/release-notes/${tag}.md`, ' \n\t\n')
  assert.throws(() => release.validate())
})

for (const candidate of ['1.2.0', 'v1.2', 'v1.2.0-rc.1', 'v1.2.0+build', 'v01.2.0', 'v1.2.0/../../escape']) {
  test(`invalid stable-release tag ${candidate} is rejected`, (t) => {
    const release = fixture(t)
    assert.throws(() => release.validate(candidate), /stable release tag/i)
  })
}

test('a Cargo manifest without the StowMind package is rejected', (t) => {
  const release = fixture(t)
  release.write('src-tauri/Cargo.toml', `[package]\nname = "another-app"\nversion = "${version}"\n`)
  assert.throws(() => release.validate())
})

test('a lockfile without StowMind cannot supply the release version', (t) => {
  const release = fixture(t)
  release.write('src-tauri/Cargo.lock', `version = 3\n\n[[package]]\nname = "another-app"\nversion = "${version}"\n`)
  assert.throws(() => release.validate())
})

test('duplicate StowMind lockfile entries are rejected rather than selecting an arbitrary version', (t) => {
  const release = fixture(t)
  release.write('src-tauri/Cargo.lock', `version = 3\n\n[[package]]\nname = "stowmind"\nversion = "${version}"\n\n[[package]]\nname = "stowmind"\nversion = "1.1.0"\n`)
  assert.throws(() => release.validate())
})
