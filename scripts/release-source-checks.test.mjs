import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const { validateReleaseSource } = createRequire(import.meta.url)('./lib/release-source.cjs')

// Only read APIs exist in this fixture. No real release or workflow is touched.
function fixture() {
  const source = 'a'.repeat(40), oid = 'b'.repeat(40)
  const checks = ['frontend', 'macos'].map((name) => ({
    name, status: 'completed', conclusion: 'success', app: { id: 15368 },
  }))
  const workflow = {
    id: 700, run_number: 20, run_attempt: 3, path: '.github/workflows/pr-checks.yml',
    event: 'push', head_branch: 'main', head_sha: source, status: 'completed', conclusion: 'success',
  }
  const jobs = ['frontend', 'macos'].map((name) => ({
    name, run_id: workflow.id, head_sha: source, status: 'completed', conclusion: 'success',
  }))
  const state = { checks, workflows: [workflow], jobs, calls: [] }
  const repo = { owner: 'owner', repo: 'repo' }
  const github = { rest: {
    checks: { listForRef() {} },
    actions: { listWorkflowRuns() {}, listJobsForWorkflowRun() {} },
    git: {
      getRef: async () => ({ data: { object: { type: 'tag', sha: oid } } }),
      getTag: async () => ({ data: { object: { type: 'commit', sha: source } } }),
    },
    repos: {
      getBranch: async () => ({ data: { commit: { sha: source } } }),
      getReleaseByTag: async () => { throw Object.assign(new Error('Not found'), { status: 404 }) },
    },
  } }
  github.paginate = async (method, args) => {
    if (method === github.rest.checks.listForRef) return state.checks
    if (method === github.rest.actions.listWorkflowRuns) {
      assert.deepEqual(args, { ...repo, workflow_id: 'pr-checks.yml', head_sha: source,
        event: 'push', branch: 'main', per_page: 100 })
      state.calls.push('main-runs')
      return state.workflows
    }
    if (method === github.rest.actions.listJobsForWorkflowRun) {
      assert.deepEqual(args, { ...repo, run_id: workflow.id, filter: 'latest', per_page: 100 })
      state.calls.push('latest-jobs')
      return state.jobs
    }
    assert.fail('Unexpected API request')
  }
  return { ...state, state, workflow, source, github,
    run: () => validateReleaseSource({ github,
      context: { repo, sha: source, eventName: 'workflow_dispatch', ref: 'refs/heads/main' },
      inputs: { tag: 'v1.2.0' },
    }),
  }
}

test('publication requires exact-source main push CI and its latest successful required jobs', async () => {
  const f = fixture()
  assert.equal((await f.run()).sourceSha, f.source)
  assert.deepEqual(f.calls, ['main-runs', 'latest-jobs'])
})

test('successful same-name PR checks without a main push run do not authorize publication', async () => {
  const f = fixture()
  f.state.workflows = []
  await assert.rejects(f.run(), /main push workflow/)
  assert.deepEqual(f.calls, ['main-runs'])
})

for (const [label, patch] of [
  ['other workflow', { path: '.github/workflows/unrelated.yml' }],
  ['pull request', { event: 'pull_request' }],
  ['other branch', { head_branch: 'feature' }],
  ['other source', { head_sha: 'f'.repeat(40) }],
  ['pending run', { status: 'in_progress' }],
  ['failed run', { conclusion: 'failure' }],
  ['skipped run', { conclusion: 'skipped' }],
  ['missing identity', { id: undefined }],
  ['missing run number', { run_number: undefined }],
  ['missing attempt', { run_attempt: undefined }],
  ['invalid attempt', { run_attempt: 0 }],
]) {
  test(`main push authorization rejects ${label}`, async () => {
    const f = fixture()
    Object.assign(f.workflow, patch)
    await assert.rejects(f.run(), /main push workflow/)
    assert.deepEqual(f.calls, ['main-runs'])
  })
}

test('an older successful run cannot hide a newer failed run for the same source', async () => {
  const f = fixture()
  f.state.workflows = [
    { ...f.workflow, id: 600, run_number: 19, run_attempt: 1 },
    { ...f.workflow, conclusion: 'failure' },
  ]
  await assert.rejects(f.run(), /main push workflow/)
})

test('an older failure does not replace the latest successful main push run', async () => {
  const f = fixture()
  f.state.workflows = [
    { ...f.workflow, id: 600, run_number: 19, conclusion: 'failure' }, f.workflow,
  ]
  assert.equal((await f.run()).sourceSha, f.source)
})

for (const name of ['frontend', 'macos']) {
  for (const mode of ['missing', 'duplicate', 'wrong run', 'wrong source', 'pending', 'failed', 'skipped']) {
    test(`latest attempt ${name} job cannot be ${mode}`, async () => {
      const f = fixture(), job = f.jobs.find((entry) => entry.name === name)
      if (mode === 'missing') f.state.jobs = f.jobs.filter((entry) => entry !== job)
      if (mode === 'duplicate') f.jobs.push({ ...job })
      if (mode === 'wrong run') job.run_id -= 1
      if (mode === 'wrong source') job.head_sha = 'f'.repeat(40)
      if (mode === 'pending') job.status = 'in_progress'
      if (mode === 'failed') job.conclusion = 'failure'
      if (mode === 'skipped') job.conclusion = 'skipped'
      await assert.rejects(f.run(), new RegExp(`main push job ${name}`))
      assert.deepEqual(f.calls, ['main-runs', 'latest-jobs'])
    })
  }
}

test('a successful main push run does not replace trusted GitHub Actions app verification', async () => {
  const f = fixture()
  f.checks[0].app.id = 1
  await assert.rejects(f.run(), /GitHub Actions check frontend/)
  assert.deepEqual(f.calls, [])
})

test('missing Actions read access cannot fall back to the same-name checks', async () => {
  const f = fixture(), paginate = f.github.paginate
  f.github.paginate = async (method, args) => {
    if (method === f.github.rest.actions.listWorkflowRuns) throw Object.assign(new Error('Forbidden'), { status: 403 })
    return paginate(method, args)
  }
  await assert.rejects(f.run(), /Forbidden/)
})
