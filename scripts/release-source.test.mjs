import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
const { validateReleaseSource } = createRequire(import.meta.url)('./lib/release-source.cjs')

function fixture() {
  const original = 'a'.repeat(40), source = 'b'.repeat(40), tagOid = 'c'.repeat(40)
  const release = { id: 42, draft: false, prerelease: false, immutable: false, assets: [
    { id: 1, name: 'StowMind_1.2.0_universal.dmg', state: 'uploaded', digest: `sha256:${'d'.repeat(64)}` },
    { id: 2, name: 'SHA256SUMS.txt', state: 'uploaded', digest: `sha256:${'e'.repeat(64)}` },
  ] }
  const checks = ['frontend', 'macos'].map((name) => ({ name, status: 'completed', conclusion: 'success', app: { id: 15368 } }))
  const inputs = { tag: 'v1.2.0', replace_published: 'true', source_sha: source,
    expected_tag_oid: tagOid, expected_release_id: '42', expected_dmg_sha256: 'd'.repeat(64),
    expected_checksum_sha256: 'e'.repeat(64), reason: 'Replace the published build with reviewed cleanup reliability fixes.' }
  const context = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha: source, repo: { owner: 'owner', repo: 'repo' } }
  let checkedSha = source
  const github = { paginate: async (method, args) => {
    if (method === github.rest.actions.listWorkflowRuns) return (await method(args)).data.workflow_runs
    if (method === github.rest.actions.listJobsForWorkflowRun) return (await method(args)).data.jobs
    return checks
  }, rest: {
    git: { getRef: async () => ({ data: { object: { type: 'tag', sha: tagOid } } }),
      getTag: async () => ({ data: { object: { type: 'commit', sha: original } } }) },
    actions: { listWorkflowRuns: async ({ head_sha }) => { checkedSha = head_sha; return { data: { workflow_runs: [{ id: 77, run_number: 1,
      path: '.github/workflows/pr-checks.yml', event: 'push', head_branch: 'main', head_sha,
      status: 'completed', conclusion: 'success', run_attempt: 1 }] } } },
      listJobsForWorkflowRun: async () => ({ data: { jobs: checks.map(({ name, status, conclusion }) => ({ name, status, conclusion, run_id: 77, head_sha: checkedSha })) } }) },
    checks: { listForRef() {} }, repos: { getBranch: async () => ({ data: { commit: { sha: source } } }),
      getReleaseByTag: async () => ({ data: release }) },
  } }
  return { inputs, context, github, release, checks, source, original, tagOid,
    run() { return validateReleaseSource({ github: this.github, context: this.context, inputs: this.inputs }) } }
}

test('replacement selects reviewed current main without moving the old tag', async () => {
  const f = fixture(), result = await f.run()
  assert.equal(result.sourceSha, f.source)
  assert.equal(result.tagCommit, f.original)
  assert.equal(result.tagOid, f.tagOid)
  assert.equal(result.replacement, true)
  assert.match(result.requestId, /^[a-f0-9]{64}$/)
})

for (const field of ['source_sha', 'expected_tag_oid', 'expected_release_id', 'expected_dmg_sha256', 'expected_checksum_sha256', 'reason']) {
  test(`replacement rejects missing or malformed ${field}`, async () => {
    const f = fixture(); f.inputs[field] = 'invalid'
    await assert.rejects(f.run())
  })
}
for (const [field, value] of [['immutable', true], ['immutable', undefined], ['draft', true], ['prerelease', true], ['id', 99]]) {
  test(`unexpected public release state ${field}=${value} is blocked`, async () => {
    const f = fixture(); f.release[field] = value
    await assert.rejects(f.run(), /expected mutable public stable release/)
  })
}
for (const name of ['frontend', 'macos']) {
  for (const patch of [{ conclusion: 'failure' }, { status: 'in_progress' }, { app: { id: 1 } }]) {
    test(`release blocks ${name} without a trusted successful result: ${JSON.stringify(patch)}`, async () => {
      const f = fixture(); Object.assign(f.checks.find((item) => item.name === name), patch)
      await assert.rejects(f.run(), new RegExp(name))
    })
  }
}
test('dispatch from an unreviewed branch is blocked', async () => {
  const f = fixture(); f.context.ref = 'refs/heads/feature'
  await assert.rejects(f.run(), /reviewed main workflow/)
})
test('normal publication keeps its tag as the source and refuses published assets', async () => {
  const f = fixture(); f.inputs = { tag: 'v1.2.0' }
  f.context.sha = f.original
  f.github.rest.repos.getBranch = async () => ({ data: { commit: { sha: f.original } } })
  await assert.rejects(f.run(), /explicit replacement/)
  f.release.draft = true
  const result = await f.run()
  assert.equal(result.sourceSha, f.original)
  assert.equal(result.replacement, false)
})
test('normal publication rejects hidden replacement fields', async () => {
  const f = fixture(); f.inputs = { tag: 'v1.2.0', source_sha: f.original }; f.release.draft = true
  f.context.sha = f.original
  f.github.rest.repos.getBranch = async () => ({ data: { commit: { sha: f.original } } })
  await assert.rejects(f.run(), /Replacement inputs/)
})
test('a tag-triggered new release still requires the exact main commit and checks', async () => {
  const f = fixture(); f.inputs = {}; f.context.eventName = 'push'; f.context.ref = 'refs/tags/v1.2.0'
  f.github.rest.repos.getBranch = async () => ({ data: { commit: { sha: f.original } } })
  f.github.rest.repos.getReleaseByTag = async () => { throw Object.assign(new Error('not found'), { status: 404 }) }
  assert.equal((await f.run()).sourceSha, f.original)
})
