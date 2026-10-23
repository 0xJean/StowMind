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

test('processed amounts preserve lower bounds and completeness without entering freed totals', () => {
  for (const [kind, pattern] of [['at_least', /至少 100 B/], ['unspecified', /完整性未提供/]]) {
    const value = record('processed')
    value.cleanupSummary.processedSize = 100
    value.cleanupSummary.processedSizeKind = kind
    assert.match(labels.cleanupHistorySizeLabel(value, t), pattern)
    assert.equal(activity.cleanupFreedSize(value), 0)
    assert.equal(activity.cleanupProcessedSize(value), 100)
  }
  const partial = record('unknown', { totalSize: undefined })
  partial.cleanupSummary.processedSizeKind = 'partial'
  assert.match(labels.cleanupHistorySizeLabel(partial, t), /仅部分测量/)
  assert.equal(activity.cleanupProcessedSize(partial), 0)
})

test('one execution can retain separate physical freed and processed metrics exactly once', () => {
  const value = record('reported_freed')
  value.cleanupSummary.processedSize = 250
  value.cleanupSummary.processedSizeKind = 'at_least'
  assert.equal(activity.cleanupFreedSize(value), 100)
  assert.equal(activity.cleanupProcessedSize(value), 250)
  assert.match(labels.cleanupHistoryProcessedLabel(value, t), /至少 250 B/)
  value.cleanupSummary.sizeKind = 'processed'
  assert.equal(labels.cleanupHistoryProcessedLabel(value, t), null)
  assert.equal(activity.cleanupProcessedSize(value), 250)
  for (const patch of [{ executed: false }, { undone: true }]) {
    assert.equal(activity.cleanupProcessedSize({ ...value, ...patch }), 0)
  }
})

test('history keeps Mole item totals distinct from confirmed operation and failure records', () => {
  const value = record('processed', { itemCount: 511 })
  Object.assign(value.cleanupSummary, { itemCountSource: 'mole', operationCount: 946, failedCount: 4, operationLogStatus: 'available' })
  assert.equal(labels.cleanupHistoryCountLabel(value, t), '共 511 项')
  assert.deepEqual([...labels.cleanupHistoryOperationLabels(value, t)], ['946 条操作记录', '4 条失败记录'])
  value.cleanupSummary.itemCountSource = 'operation_log'
  assert.equal(labels.cleanupHistoryCountLabel(value, t), '511 条操作记录')
  assert.deepEqual([...labels.cleanupHistoryOperationLabels(value, t)], ['4 条失败记录'])
  for (const status of ['ambiguous', 'unavailable']) {
    value.cleanupSummary.operationLogStatus = status
    assert.deepEqual([...labels.cleanupHistoryOperationLabels(value, t)], [])
  }
})

test('partial-only history has one measurement explanation and no duplicate secondary label', () => {
  const value = record('unknown', { totalSize: undefined })
  value.cleanupSummary.processedSizeKind = 'partial'
  assert.match(labels.cleanupHistorySizeLabel(value, t), /仅部分测量/)
  assert.equal(labels.cleanupHistoryProcessedLabel(value, t), null)
  Object.assign(value.cleanupSummary, { sizeKind: 'reported_freed', totalSize: 20 })
  assert.equal(labels.cleanupHistorySizeLabel(value, t), '释放 20 B')
  assert.match(labels.cleanupHistoryProcessedLabel(value, t), /仅部分测量/)
})

test('HUD optimization activity counts only executed, retained work', () => {
  const entries = [
    record('unknown', { type: 'optimize', itemCount: 2 }),
    record('unknown', { type: 'optimize', itemCount: null, executed: false, outcome: 'unknown' }),
    { ...record('unknown', { type: 'optimize', itemCount: 2 }), undone: true },
    record('unknown', { type: 'optimize', itemCount: 0, executed: false, outcome: 'failed' }),
    record('unknown', { type: 'optimize', action: 'preview', executed: false }),
  ]
  assert.equal(activity.buildCleanupActivitySummary(entries, {}).optimizedCount, 1)
})
