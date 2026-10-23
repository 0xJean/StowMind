import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './ios-organizer-test-harness.mjs'

const activity = loadTypeScript('../src/lib/stowmind-supplements/cleanupActivity.ts', {})
const history = loadTypeScript('../src/lib/historyRecords.ts', {})
const { zh } = loadTypeScript('../src/i18n/zh.ts', {})
const labels = loadTypeScript('../src/pages/history/cleanupLabels.ts', {
  '@/lib/utils': { formatFileSize: (bytes) => `${bytes} B` },
})
const t = (key, vars = {}) => Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), zh[key])
const record = (sizeKind, extra = {}) => history.createCleanupHistoryRecord({
  type: 'clean', target: 'Test cleanup', label: 'Cleanup', itemCount: 3, totalSize: 100,
  action: 'execute', executed: true, sizeKind, ...extra,
})

test('only confirmed execution reports contribute to freed-space totals', () => {
  const kinds = ['reported_freed', 'estimated', 'processed', 'unknown', undefined]
  for (const kind of kinds) {
    const value = record(kind)
    assert.equal(activity.cleanupFreedSize(value), kind === 'reported_freed' ? 100 : 0)
  }
  for (const patch of [{ executed: false }, { undone: true }, { cleanupSummary: { totalSize: NaN, sizeKind: 'reported_freed' } }]) {
    assert.equal(activity.cleanupFreedSize({ ...record('reported_freed'), ...patch }), 0)
  }
})

test('legacy preview-contaminated counters and Trash sizes cannot re-enter global freed metrics', () => {
  const statistics = {
    cleanSizeFreed: 30_000, agentCleanupSizeFreed: 20_000,
    agentCleanupProcessedBytes: 20_000, reportedFreedBytes: 250,
  }
  const result = activity.buildCleanupActivitySummary([
    record('processed', { type: 'agent-cleanup', totalSize: 20_000 }),
    record('estimated', { type: 'purge', totalSize: 30_000 }),
    record(undefined, { totalSize: 10_000 }), record('reported_freed'),
  ], statistics)
  assert.equal(result.totalFreed, 250, 'The lifetime confirmed counter overlaps with retained history')
  assert.equal(result.executedCount, 4)
})

test('unknown counts and sizes remain absent in history instead of becoming a zero result', () => {
  const value = record('unknown', { itemCount: null, totalSize: undefined })
  assert.equal(value.cleanupSummary.itemCount, undefined)
  assert.equal(value.cleanupSummary.totalSize, undefined)
  assert.equal(Object.keys(value.categories).length, 0)
  assert.equal(labels.cleanupHistorySizeLabel(value, t), '释放空间未知')
})

test('history labels distinguish previews, estimates, processed files and reported freed space', () => {
  assert.match(labels.cleanupHistorySizeLabel(record('processed'), t), /已处理.*不代表磁盘释放量/)
  assert.match(labels.cleanupHistorySizeLabel(record('estimated'), t), /估算.*非确认释放量/)
  assert.match(labels.cleanupHistorySizeLabel(record(undefined), t), /估算/)
  assert.equal(labels.cleanupHistorySizeLabel(record('reported_freed'), t), '释放 100 B')
  assert.equal(labels.cleanupHistorySizeLabel(record('estimated', { action: 'preview', executed: false }), t), '预计 100 B')
})
