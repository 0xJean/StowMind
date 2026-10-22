import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateReleaseManifest({ tag, root = process.cwd() }) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) throw new Error('A stable release tag vX.Y.Z is required.')
  const expected = tag.slice(1)
  const read = (path) => readFileSync(resolve(root, path), 'utf8')
  const cargoPackage = read('src-tauri/Cargo.toml').match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1]
  const lockPackage = read('src-tauri/Cargo.lock').split(/^\[\[package\]\]\s*$/m)
    .filter((section) => /^name\s*=\s*"stowmind"\s*$/m.test(section))
  if (!cargoPackage || !/^name\s*=\s*"stowmind"\s*$/m.test(cargoPackage) || lockPackage.length !== 1) {
    throw new Error('Expected exactly one stowmind package in Cargo manifests.')
  }
  const cargoVersion = (section) => section.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  const versions = {
    'package.json': JSON.parse(read('package.json')).version,
    'src-tauri/Cargo.toml': cargoVersion(cargoPackage),
    'src-tauri/Cargo.lock': cargoVersion(lockPackage[0]),
    'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).package?.version,
  }
  for (const [path, version] of Object.entries(versions)) {
    if (version !== expected) throw new Error(`${path} version ${version ?? '(missing)'} does not match ${tag}.`)
  }
  const notes = `.github/release-notes/${tag}.md`
  if (!existsSync(resolve(root, notes)) || !read(notes).trim()) throw new Error(`Release notes are required: ${notes}`)
  return expected
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(`Release manifest verified: v${validateReleaseManifest({ tag: process.argv[2] ?? process.env.TAG_NAME })}`)
  } catch (cause) {
    console.error(`::error::${cause.message}`)
    process.exitCode = 1
  }
}
