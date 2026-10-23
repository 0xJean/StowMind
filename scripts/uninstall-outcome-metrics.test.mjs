import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './ios-organizer-test-harness.mjs'

const records = loadTypeScript('../src/lib/historyRecords.ts', {})
const activity = loadTypeScript('../src/lib/stowmind-supplements/cleanupActivity.ts', {})
const app = { name: 'Example', path: '/Applications/Example.app', uninstall_name: 'Example' }
const t = (key) => key

function fixture() {
  const state = {
    history: [], statistics: { cleanItemsRemoved: 5, cleanOperationCount: 2, cleanSizeFreed: 999, reportedFreedBytes: 10 },
    addHistory(record) { state.history.push(record) },
    updateStatistics(next) { Object.assign(state.statistics, next) },
  }
  const api = loadTypeScript('../src/pages/application-management/uninstallOutcome.ts', {
    '@/lib/historyRecords': records, '@/stores/app': { useAppStore: { getState: () => state } },
  })
  return { state, record: (result, interruption) => api.recordUninstallExecution(result, app, t, interruption) }
}

for (const permanent of [false, true]) {
  for (const interruption of [undefined, 'cancelled', 'timeout', 'failed']) {
    test(`${permanent ? 'permanent' : 'Trash'} uninstall ${interruption ?? 'completion'} retains processed size and confirmed count`, () => {
      const f = fixture()
      f.record({ item_count: 1, total_size: 1024, dry_run: false, permanent, raw_output: 'Removed 1 app, freed 1KB' }, interruption)
      const history = f.state.history[0]
      assert.equal(history.executed, true)
      assert.equal(history.cleanupSummary.itemCount, 1)
      assert.equal(history.cleanupSummary.totalSize, 1024)
      assert.equal(history.cleanupSummary.sizeKind, 'processed')
      assert.equal(history.cleanupSummary.outcome, interruption ? 'partial' : 'success')
      assert.equal(activity.cleanupFreedSize(history), 0)
      assert.equal(f.state.statistics.cleanItemsRemoved, 6)
      assert.equal(f.state.statistics.cleanOperationCount, 3)
      assert.equal(f.state.statistics.lastCleaned, history.timestamp)
      assert.equal(f.state.statistics.reportedFreedBytes, 10)
      assert.equal(f.state.statistics.cleanSizeFreed, 999)
      if (interruption) assert.ok(history.cleanupSummary.errors.length)
    })
  }
}

for (const itemCount of [null, 0]) {
  test(`interrupted uninstall count ${itemCount} cannot create a successful cleanup operation`, () => {
    const f = fixture()
    f.record({ item_count: itemCount, total_size: itemCount === null ? null : 0, dry_run: false, permanent: true }, 'timeout')
    assert.equal(f.state.history[0].executed, false)
    assert.equal(f.state.history[0].cleanupSummary.outcome, 'unknown')
    assert.equal(f.state.statistics.cleanItemsRemoved, 5)
    assert.equal(f.state.statistics.cleanOperationCount, 2)
    assert.equal(f.state.statistics.lastCleaned, undefined)
    assert.equal(f.state.statistics.reportedFreedBytes, 10)
  })
}

test('confirmed partial uninstall count remains usable when processed size is absent', () => {
  const f = fixture()
  f.record({ item_count: 1, total_size: null, dry_run: false, permanent: true }, 'cancelled')
  assert.equal(f.state.history[0].cleanupSummary.totalSize, undefined)
  assert.equal(f.state.history[0].cleanupSummary.sizeKind, 'unknown')
  assert.equal(f.state.history[0].cleanupSummary.outcome, 'partial')
  assert.equal(f.state.statistics.cleanItemsRemoved, 6)
  assert.equal(f.state.statistics.cleanOperationCount, 3)
  assert.equal(f.state.statistics.reportedFreedBytes, 10)
})

test('a dry-run result attached to an interruption is not execution evidence', () => {
  const f = fixture()
  f.record({ item_count: 1, total_size: 1024, dry_run: true, permanent: true }, 'cancelled')
  assert.equal(f.state.history.length, 0)
  assert.equal(f.state.statistics.cleanItemsRemoved, 5)
  assert.equal(f.state.statistics.cleanOperationCount, 2)
  assert.equal(f.state.statistics.reportedFreedBytes, 10)
})
