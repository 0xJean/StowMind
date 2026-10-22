import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './ios-organizer-test-harness.mjs'

const baseline = {
  totalFilesOrganized: 0, totalSizeOrganized: 0, categoryCounts: {},
  cleanSizeFreed: 80, cleanOperationCount: 2,
  systemCacheCleanupCount: 0, systemCacheObservedBytes: 0,
}
let state
const reset = () => {
  state = {
    history: [], statistics: { ...baseline },
    addHistory(record) { state.history.unshift(record) },
    updateStatistics(values) { state.statistics = { ...state.statistics, ...values } },
  }
}
const helper = loadTypeScript('../src/lib/stowmind-supplements/systemCacheHistory.ts', {
  '@/stores/app': { useAppStore: { getState: () => state } },
})
const activity = loadTypeScript('../src/lib/stowmind-supplements/cleanupActivity.ts', {})

const report = {
  source: 'stowmind_supplement', target_id: 'iconservices',
  path: '/Library/Caches/com.apple.iconservices.store', scanned_at: 1_700_000_000,
  status: 'complete', size_bytes: 1_000, modified_at: 1_699_000_000,
  authorized: true, anomaly: true, threshold_bytes: 100,
  message: 'Measured', mole_supported: true, mole_message: 'Mole 1.60.0',
  review_token: 'must-not-persist',
}
const outcome = {
  source: 'mole', before: report, after: { ...report, size_bytes: 100 },
  success: true, attempted: true, errors: [], measured_delta_bytes: 900,
  completed_at: 1_700_000_010,
}

test('records measured cache reduction separately from physical space freed', () => {
  reset()
  helper.recordSystemCacheCleanup(outcome, 'System cache')
  const record = state.history[0]
  assert.equal(record.executed, true)
  assert.equal(record.directory, report.path)
  assert.equal(record.cleanupSummary.totalSize, undefined)
  assert.equal(record.cleanupSummary.systemCache.observedDeltaBytes, 900)
  assert.equal(state.statistics.cleanSizeFreed, 80)
  assert.equal(state.statistics.systemCacheObservedBytes, 900)
  assert.equal(state.statistics.systemCacheCleanupCount, 1)
  assert.equal(JSON.stringify(record).includes('must-not-persist'), false)
  const summary = activity.buildCleanupActivitySummary(state.history, state.statistics)
  assert.equal(summary.totalFreed, 80)
  assert.equal(summary.observedCacheReduction, 900)
  assert.equal(summary.executedCount, 3)
})

test('an absent target is a zero-sized observation even with a null size payload', () => {
  reset()
  helper.recordSystemCacheCleanup({
    ...outcome,
    after: { ...report, status: 'not_found', size_bytes: null, modified_at: null },
    measured_delta_bytes: report.size_bytes,
  }, 'System cache')
  const details = state.history[0].cleanupSummary.systemCache
  assert.equal(details.after.status, 'not_found')
  assert.equal(details.after.sizeBytes, 0)
  assert.equal(details.observedDeltaBytes, 1_000)
  assert.equal(state.statistics.systemCacheObservedBytes, 1_000)
  assert.equal(state.statistics.systemCacheMeasuredRuns, 1)
  assert.equal(state.statistics.cleanSizeFreed, 80)
})

for (const status of ['permission_denied', 'timed_out', 'partial', 'error']) {
  test(`keeps ${status} verification unknown and does not invent a measured reduction`, () => {
    reset()
    helper.recordSystemCacheCleanup({
      ...outcome, after: { ...report, status, size_bytes: null }, measured_delta_bytes: null,
    }, 'System cache')
    assert.equal(state.history[0].cleanupSummary.systemCache.after.sizeBytes, null)
    assert.equal(state.history[0].cleanupSummary.systemCache.observedDeltaBytes, null)
    assert.equal(state.statistics.systemCacheMeasuredRuns, 0)
    assert.equal(state.statistics.cleanSizeFreed, 80)
  })
}

for (const [attempted, status] of [[true, 'failed'], [false, 'skipped']]) {
  test(`${status} cleanup stays in history without successful statistics or preview count`, () => {
    reset()
    helper.recordSystemCacheCleanup({ ...outcome, attempted, success: false, errors: ['Mole refused'] }, 'System cache')
    assert.equal(state.history[0].executed, false)
    assert.equal(state.history[0].cleanupSummary.outcome, status)
    assert.equal(state.history[0].cleanupSummary.errors[0], 'Mole refused')
    assert.equal(state.statistics.systemCacheCleanupCount, 0)
    const summary = activity.buildCleanupActivitySummary(state.history, state.statistics)
    assert.equal(summary.previewCount, 0)
    assert.equal(summary.observedCacheReduction, 0)
    assert.equal(summary.latestExecuted, undefined)
  })
}

test('rebuilding cache records increased usage without adding negative freed space', () => {
  reset()
  helper.recordSystemCacheCleanup({ ...outcome, after: { ...report, size_bytes: 1_200 }, measured_delta_bytes: -200 }, 'System cache')
  assert.equal(state.history[0].cleanupSummary.systemCache.observedDeltaBytes, -200)
  assert.equal(state.statistics.systemCacheObservedBytes, 0)
  assert.equal(state.statistics.systemCacheMeasuredRuns, 1)
})

test('completion reads the latest statistics instead of a stale UI snapshot', () => {
  reset()
  state.statistics.systemCacheCleanupCount = 4
  state.statistics.systemCacheObservedBytes = 2_000
  helper.recordSystemCacheCleanup(outcome, 'System cache')
  helper.recordSystemCacheCleanup(outcome, 'System cache')
  assert.equal(state.statistics.systemCacheCleanupCount, 6)
  assert.equal(state.statistics.systemCacheObservedBytes, 3_800)
})

test('rejects partial numeric payloads as measurement authority', () => {
  reset()
  helper.recordSystemCacheCleanup({ ...outcome, after: { ...report, status: 'partial', size_bytes: 100 } }, 'System cache')
  assert.equal(state.history[0].cleanupSummary.systemCache.after.sizeBytes, null)
  assert.equal(state.history[0].cleanupSummary.systemCache.observedDeltaBytes, null)
  assert.equal(state.statistics.systemCacheMeasuredRuns, 0)
})
