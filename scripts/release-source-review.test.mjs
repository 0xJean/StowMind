import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const { validateReleaseSource } = createRequire(import.meta.url)('./lib/release-source.cjs')

// Independent read-only gate regression: mocks expose no GitHub mutation API.
function fixture() {
  const source = 'a'.repeat(40), old = 'b'.repeat(40), oid = 'c'.repeat(40)
  const inputs = {
    tag: 'v1.2.0', replace_published: true, source_sha: source,
    expected_tag_oid: oid, expected_release_id: '42',
    expected_dmg_sha256: 'd'.repeat(64), expected_checksum_sha256: 'e'.repeat(64),
    reason: 'Replace the existing release with reviewed cleanup reliability fixes.',
  }
  const reference = { type: 'tag', sha: oid }
  const context = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha: source, repo: { owner: 'owner', repo: 'repo' } }
  const release = {
    id: 42, draft: false, prerelease: false, immutable: false,
    assets: [
      { id: 11, name: 'StowMind_1.2.0_universal.dmg', state: 'uploaded', size: 100, digest: `sha256:${inputs.expected_dmg_sha256}` },
      { id: 12, name: 'SHA256SUMS.txt', state: 'uploaded', size: 95, digest: `sha256:${inputs.expected_checksum_sha256}` },
      { id: 13, name: 'unrelated-user-asset.txt', state: 'uploaded', size: 20, digest: `sha256:${'f'.repeat(64)}` },
    ],
  }
  const workflowRuns = new Map()
  const actions = { listWorkflowRuns() {}, listJobsForWorkflowRun() {} }
  const github = {
    paginate: async (method, args) => {
      if (method === actions.listWorkflowRuns) {
        assert.equal(args.workflow_id, 'pr-checks.yml')
        assert.equal(args.event, 'push')
        assert.equal(args.branch, 'main')
        assert.match(args.head_sha, /^[a-f0-9]{40}$/)
        const run = { id: 700 + workflowRuns.size, run_number: 1, run_attempt: 1,
          path: '.github/workflows/pr-checks.yml', event: 'push', head_branch: 'main',
          head_sha: args.head_sha, status: 'completed', conclusion: 'success' }
        workflowRuns.set(run.id, run)
        return [run]
      }
      if (method === actions.listJobsForWorkflowRun) {
        assert.equal(args.filter, 'latest')
        const run = workflowRuns.get(args.run_id)
        assert.ok(run, 'Jobs must belong to the selected successful workflow run')
        return ['frontend', 'macos'].map((name) => ({ name, run_id: run.id, head_sha: run.head_sha, status: 'completed', conclusion: 'success' }))
      }
      assert.equal(method, github.rest.checks.listForRef)
      return ['frontend', 'macos'].map((name) => ({ name, status: 'completed', conclusion: 'success', app: { id: 15368 } }))
    },
    rest: {
      git: {
        getRef: async () => ({ data: { object: reference } }),
        getTag: async () => ({ data: { object: { type: 'commit', sha: old } } }),
      },
      checks: { listForRef() {} },
      actions,
      repos: {
        getBranch: async () => ({ data: { commit: { sha: source } } }),
        getReleaseByTag: async () => ({ data: release }),
      },
    },
  }
  return {
    release, reference, inputs, source, old, github, context,
    run: () => validateReleaseSource({ github, inputs, context }),
  }
}

async function recoveryFixture() {
  const f = fixture()
  const original = await f.run()
  const current = 'f'.repeat(40), checked = []
  f.context.sha = current
  const run = {
    id: 900, path: '.github/workflows/publish.yml', event: 'workflow_dispatch',
    head_branch: 'main', head_sha: f.source, status: 'completed',
    repository: { full_name: 'owner/repo' }, run_attempt: 2,
  }
  f.inputs.recovery_run_id = '900'
  // Recovery must work even if the previous attempt already renamed canonical
  // assets and main advanced to a reviewed repair of the recovery program.
  f.release.assets = []
  f.github.rest.repos.getBranch = async () => ({ data: { commit: { sha: current } } })
  f.github.rest.repos.compareCommitsWithBasehead = async ({ basehead }) => {
    assert.equal(basehead, `${f.source}...${current}`)
    return { data: { status: 'ahead' } }
  }
  Object.assign(f.github.rest.actions, { getWorkflowRun: async ({ run_id }) => {
    assert.equal(run_id, 900)
    return { data: run }
  } })
  const paginate = f.github.paginate
  f.github.paginate = async (method, args) => {
    if (method === f.github.rest.checks.listForRef) checked.push(args.ref)
    return paginate(method, args)
  }
  return { ...f, original, current, checked, workflowRun: run }
}

test('recovery after reviewed main advances preserves the original transaction and checks both sources', async () => {
  const f = await recoveryFixture(), result = await f.run()
  assert.equal(result.sourceSha, f.source)
  assert.equal(result.controlSha, f.current)
  assert.equal(result.requestId, f.original.requestId)
  assert.equal(result.recoveryRunId, 900)
  assert.equal(result.recoveryRunAttempt, 2)
  assert.deepEqual(f.checked, [f.current, f.source])
})

test('a manual workflow running stale main code cannot publish the newer source', async () => {
  const f = fixture()
  f.context.sha = '0'.repeat(40)
  await assert.rejects(f.run(), /workflow|main|source/i)
})

test('recovery cannot execute a stale control workflow after main advances', async () => {
  const f = await recoveryFixture()
  f.context.sha = f.source
  await assert.rejects(f.run(), /workflow|main|source/i)
})

test('an explicit older recovery attempt selects its archived transaction instead of the latest rerun', async () => {
  const f = await recoveryFixture()
  f.inputs.recovery_run_attempt = '1'
  f.github.rest.actions.getWorkflowRun = async () => assert.fail('Explicit attempt must not resolve the latest rerun')
  f.github.rest.actions.getWorkflowRunAttempt = async ({ run_id, attempt_number }) => {
    assert.equal(run_id, 900)
    assert.equal(attempt_number, 1)
    return { data: { ...f.workflowRun, run_attempt: 1 } }
  }
  const result = await f.run()
  assert.equal(result.recoveryRunAttempt, 1)
  assert.equal(result.requestId, f.original.requestId)
})

test('an explicit recovery attempt cannot accept metadata from a different attempt', async () => {
  const f = await recoveryFixture()
  f.inputs.recovery_run_attempt = '1'
  f.github.rest.actions.getWorkflowRunAttempt = async () => ({ data: f.workflowRun })
  await assert.rejects(f.run(), /Recovery journal/)
})

for (const attempt of ['0', '-1', '1.5', 'invalid']) {
  test(`recovery rejects invalid explicit attempt ${attempt}`, async () => {
    const f = await recoveryFixture()
    f.inputs.recovery_run_attempt = attempt
    await assert.rejects(f.run(), /recovery attempt/i)
  })
}

test('a recovery attempt cannot be supplied without its workflow run identity', async () => {
  const f = fixture()
  f.inputs.recovery_run_attempt = '1'
  await assert.rejects(f.run(), /recovery attempt/i)
})

for (const [name, patch] of [
  ['workflow path', { path: '.github/workflows/other.yml' }],
  ['event', { event: 'pull_request' }],
  ['branch', { head_branch: 'feature' }],
  ['source SHA', { head_sha: '0'.repeat(40) }],
  ['incomplete run', { status: 'in_progress' }],
  ['repository', { repository: { full_name: 'other/repo' } }],
  ['missing attempt', { run_attempt: undefined }],
  ['zero attempt', { run_attempt: 0 }],
  ['fractional attempt', { run_attempt: 1.5 }],
]) {
  test(`recovery blocks a journal from the wrong ${name}`, async () => {
    const f = await recoveryFixture()
    Object.assign(f.workflowRun, patch)
    await assert.rejects(f.run(), /Recovery journal/)
  })
}

for (const status of ['behind', 'diverged']) {
  test(`recovery cannot authorize an original source ${status} from current main`, async () => {
    const f = await recoveryFixture()
    f.github.rest.repos.compareCommitsWithBasehead = async () => ({ data: { status } })
    await assert.rejects(f.run(), /reviewed main history/)
  })
}

for (const target of ['original', 'current']) {
  test(`recovery still requires successful checks on the ${target} source`, async () => {
    const f = await recoveryFixture(), checked = target === 'original' ? f.source : f.current
    const paginate = f.github.paginate
    f.github.paginate = async (method, args) => {
      const results = await paginate(method, args)
      if (args.ref === checked) results.find((item) => item.name === 'macos').conclusion = 'failure'
      return results
    }
    await assert.rejects(f.run(), /macos/)
  })
}

test('ordinary publication cannot smuggle a recovery run ID into a separate workflow branch', async () => {
  const f = fixture()
  for (const key of Object.keys(f.inputs)) delete f.inputs[key]
  Object.assign(f.inputs, { tag: 'v1.2.0', recovery_run_id: '900' })
  await assert.rejects(f.run(), /Recovery|Replacement/)
})

test('replacement gate accepts unchanged annotated tag and matching published asset identities', async () => {
  const f = fixture(), result = await f.run()
  assert.equal(result.sourceSha, f.source)
  assert.equal(result.tagCommit, f.old)
  assert.equal(result.replacement, true)
})

test('matching a lightweight ref is insufficient authorization to replace an annotated release tag', async () => {
  const f = fixture()
  f.reference.type = 'commit'
  f.reference.sha = f.old
  f.inputs.expected_tag_oid = f.old
  await assert.rejects(f.run(), /annotated|tag/i)
})

for (const name of ['StowMind_1.2.0_universal.dmg', 'SHA256SUMS.txt']) {
  test(`replacement gate blocks a changed published digest for ${name}`, async () => {
    const f = fixture()
    f.release.assets.find((asset) => asset.name === name).digest = `sha256:${'0'.repeat(64)}`
    await assert.rejects(f.run(), /asset|digest|checksum/i)
  })
  test(`replacement gate blocks missing, duplicate, or incomplete ${name}`, async () => {
    for (const mode of ['missing', 'duplicate', 'starter', 'missing digest', 'empty digest']) {
      const f = fixture(), asset = f.release.assets.find((item) => item.name === name)
      if (mode === 'missing') f.release.assets = f.release.assets.filter((item) => item !== asset)
      if (mode === 'duplicate') f.release.assets.push({ ...asset, id: 99 })
      if (mode === 'starter') asset.state = 'starter'
      if (mode === 'missing digest') delete asset.digest
      if (mode === 'empty digest') asset.digest = ''
      await assert.rejects(f.run(), /asset|digest|checksum/i, mode)
    }
  })
}
