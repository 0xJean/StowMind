#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const helperOnly = process.argv.includes('--helper-only')
const debugConfigPath = join(root, 'src-tauri', 'tauri.ios.debug.conf.json')
const appPath = join(
  root,
  'src-tauri',
  'target',
  'debug',
  'bundle',
  'macos',
  'StowMind Dev.app'
)
const helperPath = join(
  appPath,
  'Contents',
  'Resources',
  'binaries',
  'stowmind-ios-helper'
)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const details = options.capture
      ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
      : ''
    throw new Error(`${command} failed${details ? `: ${details}` : ''}`)
  }
  return result
}

function availableSigningIdentities() {
  if (process.platform !== 'darwin') return []
  const result = run(
    'security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { capture: true }
  )
  return [...result.stdout.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

function resolveSigningIdentity() {
  const identities = availableSigningIdentities()
  const requested = process.env.STOWMIND_DEBUG_SIGNING_IDENTITY
    || process.env.APPLE_SIGNING_IDENTITY
  if (requested) {
    if (!identities.includes(requested)) {
      throw new Error(`Requested signing identity is not available: ${requested}`)
    }
    return { identity: requested, stable: true }
  }

  const appleDevelopment = identities.find((identity) =>
    identity.startsWith('Apple Development:')
  )
  if (appleDevelopment) return { identity: appleDevelopment, stable: true }

  const developerId = identities.find((identity) =>
    identity.startsWith('Developer ID Application:')
  )
  if (developerId) return { identity: developerId, stable: true }

  return { identity: '-', stable: false }
}

function signingDetails(path) {
  const detailsResult = run(
    'codesign',
    ['-dv', '--verbose=4', path],
    { capture: true }
  )
  const requirementResult = run('codesign', ['-dr', '-', path], { capture: true })
  const output = `${detailsResult.stdout ?? ''}\n${detailsResult.stderr ?? ''}`
  const requirementOutput = [
    requirementResult.stdout ?? '',
    requirementResult.stderr ?? '',
  ].join('\n')
  return {
    teamId: output.match(/TeamIdentifier=([^\s]+)/)?.[1] ?? null,
    authority: output.match(/^Authority=([^\n]+)/m)?.[1]?.trim() ?? null,
    requirement: requirementOutput.match(/designated => ([^\n]+)/)?.[1]?.trim()
      ?? null,
  }
}

function verifyBundle(signing) {
  run('codesign', [
    '--verify',
    '--strict',
    '--all-architectures',
    '--verbose=2',
    helperPath,
  ])
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  const app = signingDetails(appPath)
  const helper = signingDetails(helperPath)
  if (signing.stable && (!app.teamId || app.teamId !== helper.teamId)) {
    throw new Error(
      `Signing Team ID mismatch: app=${app.teamId ?? 'missing'}, `
        + `helper=${helper.teamId ?? 'missing'}`
    )
  }
  if (signing.stable) {
    for (const [label, details] of [['app', app], ['helper', helper]]) {
      if (details.authority !== signing.identity) {
        throw new Error(
          `${label} signing authority mismatch: `
            + `${details.authority ?? 'missing'}`
        )
      }
      if (
        !details.requirement
        || details.requirement.includes('cdhash')
        || !details.requirement.includes('anchor apple generic')
      ) {
        throw new Error(
          `${label} does not have a stable certificate-based requirement: `
            + `${details.requirement ?? 'missing'}`
        )
      }
    }
  }
  console.log(
    `Verified debug signing: app=${app.authority ?? 'ad-hoc'}, `
      + `helper=${helper.authority ?? 'ad-hoc'}`
  )
  if (app.teamId) console.log(`Shared Team ID: ${app.teamId}`)
  if (app.requirement) console.log(`App requirement: ${app.requirement}`)
  if (helper.requirement) console.log(`Helper requirement: ${helper.requirement}`)
}

const signing = resolveSigningIdentity()
const helperEnvironment = {
  ...process.env,
  IOS_HELPER_BUNDLE_ID: 'com.stowmind.app.debug.ios-helper',
}

if (signing.stable) {
  helperEnvironment.APPLE_SIGNING_IDENTITY = signing.identity
  delete helperEnvironment.STOWMIND_ADHOC_SIGN_HELPER
  console.log(`Using stable debug signing identity: ${signing.identity}`)
} else {
  helperEnvironment.STOWMIND_ADHOC_SIGN_HELPER = '1'
  delete helperEnvironment.APPLE_SIGNING_IDENTITY
  console.warn(
    'No Apple Development or Developer ID Application identity was found. '
      + 'Falling back to ad-hoc signing; macOS privacy permissions may need '
      + 'to be granted again after every rebuild.'
  )
}

run('bash', ['scripts/build-ios-helper.sh'], { env: helperEnvironment })

if (!helperOnly) {
  const config = JSON.parse(readFileSync(debugConfigPath, 'utf8'))
  config.tauri.bundle.macOS = {
    ...(config.tauri.bundle.macOS ?? {}),
    signingIdentity: signing.identity,
  }
  run('pnpm', [
    'exec',
    'tauri',
    'build',
    '--debug',
    '--bundles',
    'app',
    '--config',
    JSON.stringify(config),
  ])
  verifyBundle(signing)
}
