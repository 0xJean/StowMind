const crypto = require('node:crypto')

const sha = /^[a-f0-9]{40}$/
const digest = /^[a-f0-9]{64}$/

async function resolveTag(github, repo, tagName) {
  const ref = (await github.rest.git.getRef({ ...repo, ref: `tags/${tagName}` })).data
  const tagOid = ref.object.sha
  if (ref.object.type !== 'tag') throw new Error('An annotated release tag is required.')
  let object = ref.object
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++) {
    object = (await github.rest.git.getTag({ ...repo, tag_sha: object.sha })).data.object
  }
  if (object.type !== 'commit' || !sha.test(object.sha)) throw new Error('Release tag must resolve to a commit.')
  return { tagOid, tagCommit: object.sha }
}

async function requireChecks(github, repo, sourceSha) {
  const checks = await github.paginate(github.rest.checks.listForRef, {
    ...repo, ref: sourceSha, filter: 'latest', per_page: 100,
  })
  for (const name of ['frontend', 'macos']) {
    const check = checks.find((item) => item.name === name && item.app?.id === 15368)
    if (check?.status !== 'completed' || check.conclusion !== 'success') {
      throw new Error(`Required GitHub Actions check ${name} has not passed for ${sourceSha}.`)
    }
  }
  // Same-name checks on a PR or another workflow do not authorize production.
  // Do not filter by success: a newer failed/pending run must block an older pass.
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo, workflow_id: 'pr-checks.yml', head_sha: sourceSha, event: 'push', branch: 'main', per_page: 100,
  })
  const run = [...runs].sort((left, right) => right.run_number - left.run_number || right.id - left.id)[0]
  if (!run || !['id', 'run_number', 'run_attempt'].every((key) => Number.isSafeInteger(run[key]) && run[key] > 0)
    || run.path !== '.github/workflows/pr-checks.yml' || run.event !== 'push' || run.head_branch !== 'main'
    || run.head_sha !== sourceSha || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`Required main push workflow pr-checks.yml has not passed for ${sourceSha}.`)
  }
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    ...repo, run_id: run.id, filter: 'latest', per_page: 100,
  })
  for (const name of ['frontend', 'macos']) {
    const matching = jobs.filter((job) => job.name === name)
    const job = matching[0]
    if (matching.length !== 1 || job.run_id !== run.id || job.head_sha !== sourceSha
      || job.status !== 'completed' || job.conclusion !== 'success') {
      throw new Error(`Required main push job ${name} has not passed in the latest attempt for ${sourceSha}.`)
    }
  }
}

/** Read-only gate, run before the production environment and any credentials. */
async function validateReleaseSource({ github, context, inputs = {} }) {
  const repo = { owner: context.repo.owner, repo: context.repo.repo }
  const manual = context.eventName === 'workflow_dispatch'
  const tagName = manual ? inputs.tag : context.ref?.replace(/^refs\/tags\//, '')
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tagName ?? '')) {
    throw new Error('A stable release tag vX.Y.Z is required.')
  }
  const replacement = inputs.replace_published === true || inputs.replace_published === 'true'
  const recoveryRunId = inputs.recovery_run_id ? Number(inputs.recovery_run_id) : null
  const requestedAttempt = inputs.recovery_run_attempt ? Number(inputs.recovery_run_attempt) : null
  if (requestedAttempt !== null && (!recoveryRunId || !Number.isSafeInteger(requestedAttempt) || requestedAttempt <= 0)) {
    throw new Error('A recovery attempt requires a valid recovery workflow run ID and positive attempt number.')
  }
  if (recoveryRunId !== null && (!replacement || !Number.isSafeInteger(recoveryRunId) || recoveryRunId <= 0)) {
    throw new Error('Recovery requires explicit replacement authorization and a previous publish workflow run ID.')
  }
  if (!manual && !context.ref?.startsWith('refs/tags/')) throw new Error('Only release tags may trigger publication.')
  if (manual && context.ref !== 'refs/heads/main') throw new Error('Manual publication must use the reviewed main workflow.')
  if (replacement && !manual) throw new Error('Published release replacement requires an explicit manual request.')
  const tag = await resolveTag(github, repo, tagName)
  const main = (await github.rest.repos.getBranch({ ...repo, branch: 'main' })).data.commit.sha
  if (manual && context.sha !== main) throw new Error('Dispatch workflow must run at the exact current main control commit.')
  const sourceSha = replacement ? inputs.source_sha : tag.tagCommit
  if (!sha.test(sourceSha ?? '')) throw new Error('A complete release source commit SHA is required.')
  if (sourceSha !== main) {
    if (!recoveryRunId) throw new Error('Release source must be the exact current remote main commit.')
    const comparison = (await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${sourceSha}...${main}` })).data
    if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Recovery source must remain in reviewed main history.')
    await requireChecks(github, repo, main)
  }
  await requireChecks(github, repo, sourceSha)
  let release
  try {
    release = (await github.rest.repos.getReleaseByTag({ ...repo, tag: tagName })).data
  } catch (error) {
    if (error.status !== 404) throw error
  }
  if (!replacement) {
    if (release && !release.draft) throw new Error('Published releases require the explicit replacement flow.')
    if (inputs.source_sha || inputs.reason || inputs.expected_tag_oid || inputs.expected_release_id
      || inputs.expected_dmg_sha256 || inputs.expected_checksum_sha256 || inputs.recovery_run_id || inputs.recovery_run_attempt) {
      throw new Error('Replacement inputs cannot be used for ordinary publication.')
    }
    return { tagName, sourceSha, replacement: false, ...tag }
  }
  const expectedReleaseId = Number(inputs.expected_release_id)
  const reason = inputs.reason?.trim()
  if (!sha.test(inputs.expected_tag_oid ?? '') || tag.tagOid !== inputs.expected_tag_oid
    || !Number.isSafeInteger(expectedReleaseId) || expectedReleaseId <= 0
    || !digest.test(inputs.expected_dmg_sha256 ?? '') || !digest.test(inputs.expected_checksum_sha256 ?? '')
    || !reason || reason.length < 16 || reason.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(reason)) {
    throw new Error('Replacement requires the exact old tag, release ID, both asset digests, and a specific reason.')
  }
  if (!release || release.id !== expectedReleaseId || release.draft || release.prerelease || release.immutable !== false) {
    throw new Error('Only the expected mutable public stable release may be replaced.')
  }
  let recoveryRunAttempt = null
  if (!recoveryRunId) {
    for (const [name, expected] of [
      [`StowMind_${tagName.slice(1)}_universal.dmg`, inputs.expected_dmg_sha256],
      ['SHA256SUMS.txt', inputs.expected_checksum_sha256],
    ]) {
      const matches = (release.assets ?? []).filter((asset) => asset.name === name)
      if (matches.length !== 1 || matches[0].state !== 'uploaded' || matches[0].digest !== `sha256:${expected}`) {
        throw new Error(`Original canonical release asset changed or is unavailable: ${name}`)
      }
    }
  } else {
    const run = (await (requestedAttempt
      ? github.rest.actions.getWorkflowRunAttempt({ ...repo, run_id: recoveryRunId, attempt_number: requestedAttempt })
      : github.rest.actions.getWorkflowRun({ ...repo, run_id: recoveryRunId }))).data
    if (run.path !== '.github/workflows/publish.yml' || run.event !== 'workflow_dispatch'
      || run.head_branch !== 'main' || run.head_sha !== sourceSha || run.status !== 'completed'
      || run.repository?.full_name !== `${repo.owner}/${repo.repo}` || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0
      || (requestedAttempt && run.run_attempt !== requestedAttempt)) {
      throw new Error('Recovery journal must come from a completed main publish workflow in this repository.')
    }
    recoveryRunAttempt = run.run_attempt
  }
  return {
    tagName, sourceSha, replacement: true, ...tag, expectedTagOid: inputs.expected_tag_oid,
    expectedReleaseId, expectedDmgSha256: inputs.expected_dmg_sha256,
    expectedChecksumSha256: inputs.expected_checksum_sha256, reason, recoveryRunId, recoveryRunAttempt,
    controlSha: main,
    requestId: crypto.createHash('sha256').update(JSON.stringify([
      tagName, sourceSha, tag.tagOid, expectedReleaseId, inputs.expected_dmg_sha256,
      inputs.expected_checksum_sha256, reason,
    ])).digest('hex'),
  }
}

module.exports = { validateReleaseSource, resolveTag }
