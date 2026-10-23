import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './ios-organizer-test-harness.mjs'

const execution = loadTypeScript('../src/pages/clean/cleanExecutionResult.ts', {})
const summary = (raw = '', log = '', live = []) => execution.summarizeCleanExecution(live, raw, log)
const json = (value) => JSON.parse(JSON.stringify(value))
const start = (run = 'anon-1') => `# ========== clean run=${run} session started at 2026-01-01 10:00:00 ==========`
const end = (count = 2, size = '9.91GB', run = 'anon-1') => `# ========== clean run=${run} session ended at 2026-01-01 10:01:00, ${count} items, ${size} ==========`
const record = (action, label, run = 'anon-1', time = '10:00:01') => `[2026-01-01 ${time}] [clean run=${run}] ${action} ${label}`

test('tracked summary, module item count, and confirmed log records remain distinct', () => {
  const log = [start(),
    record('REMOVED', '/cache/a (8KB)'), record('REMOVED', '/cache/b (batch)'),
    record('TRASHED', '/cache/c (16KB)'), record('FAILED', '/cache/d (permission denied)'),
    record('SKIPPED', '/cache/e (whitelist)'), end(2),
  ].join('\n')
  const result = summary('Cleanup complete\nTracked cleanup: 9.91GB | Items cleaned: 2\nFree space: 100GB (+10GB)', log)
  assert.equal(result.itemCount, 2)
  assert.equal(result.itemCountSource, 'mole')
  assert.equal(result.processedSize, Math.round(9.91 * 1024 ** 3))
  assert.equal(result.processedSizeKind, 'reported')
  assert.equal(result.totalSize, null)
  assert.equal(result.operationCount, 3)
  assert.equal(result.failedCount, 1)
  assert.equal(result.skippedCount, 1)
  assert.equal(result.operationLogStatus, 'available')
})

test('lower-bound tracked measurement is not upgraded by a plain numeric session footer', () => {
  const result = summary('Cleanup complete\nTracked cleanup: At least 9.91GB | Items cleaned: 2', end())
  assert.equal(result.processedSizeKind, 'at_least')
  assert.equal(result.processedSize, Math.round(9.91 * 1024 ** 3))
  assert.equal(result.totalSize, null)
})

test('partially measured tracked output is not upgraded to zero by its footer', () => {
  const result = summary('Cleanup complete\nTracked cleanup: Partially measured | Items cleaned: 2', end(2, '0B'))
  assert.equal(result.processedSizeKind, 'partial')
  assert.equal(result.processedSize, null)
  assert.equal(result.itemCount, 2)
  assert.equal(result.totalSize, null)
})

test('footer-only size retains unspecified precision and never becomes physical freed space', () => {
  const result = summary('', end('1,234'))
  assert.equal(result.itemCount, 1234)
  assert.equal(result.itemCountSource, 'mole')
  assert.equal(result.processedSizeKind, 'unspecified')
  assert.equal(result.processedSize, Math.round(9.91 * 1024 ** 3))
  assert.equal(result.totalSize, null)
})

test('the final cleanup block overrides earlier exact/provisional measurements', () => {
  const result = summary('Cleanup complete\nSpace freed: 8GB | Items cleaned: 30\nTracked cleanup: 9GB\n' +
    'Cleanup incomplete\nTracked cleanup: At least 1GB | Items cleaned: 4')
  assert.equal(result.totalSize, null)
  assert.equal(result.processedSizeKind, 'at_least')
  assert.equal(result.processedSize, 1024 ** 3)
  assert.equal(result.itemCount, 4)
})

test('a final incomplete block with no summary cannot reuse an earlier successful block', () => {
  const result = summary('Cleanup complete\nSpace freed: 8GB | Items cleaned: 30\nCleanup interrupted\nRemaining cleanup was skipped.')
  assert.equal(result.totalSize, null)
  assert.equal(result.processedSize, null)
  assert.equal(result.itemCount, null)
  assert.equal(result.itemCountSource, 'unknown')
})

test('complete PTY output supersedes stale live summary lines', () => {
  const result = summary('Cleanup incomplete\nNo final measurement.', '', ['Space freed: 999GB | Items cleaned: 999'])
  assert.equal(result.totalSize, null)
  assert.equal(result.itemCount, null)
})

test('legacy literal Space freed remains supported with safe comma-separated counts', () => {
  const result = summary('Space freed: 1.25 GB | Items cleaned: 1,234 | Categories: 6')
  assert.equal(result.totalSize, 1.25 * 1024 ** 3)
  assert.equal(result.itemCount, 1234)
  assert.equal(result.itemCountSource, 'mole')
  assert.equal(result.processedSize, null)
})

test('ANSI and carriage return formatting preserves the final tracked measurement', () => {
  const result = summary('\u001b[34mCleanup complete\u001b[0m\r\n\u001b[32mTracked cleanup: AT LEAST 1.5 gb\u001b[0m | Items cleaned: 4\r\n')
  assert.equal(result.processedSize, 1.5 * 1024 ** 3)
  assert.equal(result.processedSizeKind, 'at_least')
  assert.equal(result.itemCount, 4)
})

for (const value of ['9007199254740992B', '999999999999999999TB', 'InfinityGB', '-1GB', '1e20GB', '1,23MB']) {
  test(`invalid or unsafe size cannot become a clean measurement: ${value}`, () => {
    const result = summary(`Cleanup complete\nSpace freed: ${value}\nTracked cleanup: ${value}`)
    assert.equal(result.totalSize, null)
    assert.equal(result.processedSize, null)
    assert.equal(result.processedSizeKind, 'unavailable')
  })
}

for (const value of ['9007199254740992', 'Infinity', '-1', '1.5', '1,23']) {
  test(`invalid or unsafe item count stays unknown: ${value}`, () => {
    const result = summary(`Cleanup complete\nTracked cleanup: 1GB | Items cleaned: ${value}`)
    assert.equal(result.itemCount, null)
    assert.equal(result.itemCountSource, 'unknown')
  })
}

test('invalid final tracked measurement does not fall back to an exact-looking footer', () => {
  const result = summary('Cleanup complete\nTracked cleanup: 1GB unexpected suffix | Items cleaned: 2', end())
  assert.equal(result.processedSize, null)
  assert.equal(result.processedSizeKind, 'unavailable')
})

test('duplicated transport lines are deduplicated without collapsing distinct timed events', () => {
  const log = [start(), record('REMOVED', '/cache/a (8KB)'),
    record('SKIPPED', '/cache/b (busy)', 'anon-1', '10:00:02'),
    record('SKIPPED', '/cache/b (busy)', 'anon-1', '10:00:03'),
    record('FAILED', '/cache/c (timeout)'), end(1),
  ].join('\n')
  const result = summary(log, log, log.split('\n'))
  assert.equal(result.operationCount, 1)
  assert.equal(result.skippedCount, 2)
  assert.equal(result.failedCount, 1)
})

test('different run identities never share counters or an arbitrary last footer', () => {
  const log = [start('anon-1'), record('REMOVED', '/cache/a', 'anon-1'), end(1, '1GB', 'anon-1'),
    start('anon-2'), record('REMOVED', '/cache/b', 'anon-2'), end(2, '2GB', 'anon-2'),
  ].join('\n')
  const result = summary('', log)
  assert.equal(result.operationLogStatus, 'ambiguous')
  assert.equal(result.itemCount, null)
  assert.equal(result.processedSize, null)
  assert.equal(result.itemCountSource, 'unknown')
  assert.deepEqual(json(execution.parseCleanOperationLog(log)), [])
  const withOwnStdout = summary('Cleanup complete\nTracked cleanup: 3GB | Items cleaned: 3', log)
  assert.equal(withOwnStdout.itemCount, 3)
  assert.equal(withOwnStdout.itemCountSource, 'mole')
  assert.equal(withOwnStdout.operationLogStatus, 'ambiguous')
})

test('record-only multiple run identities also fail closed', () => {
  const result = summary('', [record('REMOVED', '/cache/a', 'anon-1'), record('FAILED', '/cache/b', 'anon-2')].join('\n'))
  assert.equal(result.operationLogStatus, 'ambiguous')
  assert.equal(result.itemCount, null)
})

test('legacy session boundaries isolate the final session and unfinished final session', () => {
  const legacy = [start(), record('REMOVED', '/cache/old'), end(20, '20GB'),
    start(), record('REMOVED', '/cache/current'), end(1, '1GB'),
  ].join('\n').replaceAll(' run=anon-1', '')
  const result = summary('', legacy)
  assert.equal(result.itemCount, 1)
  assert.equal(result.operationCount, 1)
  assert.equal(execution.parseCleanOperationLog(legacy)[0].label, '/cache/current')
  const unfinished = summary('', `${legacy}\n${start().replace(' run=anon-1', '')}`)
  assert.equal(unfinished.itemCount, null)
  assert.equal(unfinished.processedSize, null)
})

test('single-run path confirmations provide a labeled count fallback without byte inference', () => {
  const log = [record('REMOVED', '/cache/folder (batch)'), record('TRASHED', '/cache/file (8KB)')].join('\n')
  const result = summary('', log)
  assert.equal(result.itemCount, 2)
  assert.equal(result.itemCountSource, 'operation_log')
  assert.equal(result.totalSize, null)
  assert.equal(result.processedSize, null)
  assert.equal(result.operationCount, 2)
})

test('path text, estimates, and absolute free space cannot fabricate a summary', () => {
  const log = [record('REMOVED', '/cache/Space freed: 100GB (8KB)'),
    record('REMOVED', '/cache/Tracked cleanup: 100GB | Items cleaned: 999'),
    record('REMOVED', '/cache/Mole operation log: and 500GB'),
  ].join('\n')
  const result = summary('Cleanup complete\nPotential space: 400GB\nEstimated space freed: 500GB\nFree space: 200GB (+100GB)', log)
  assert.equal(result.totalSize, null)
  assert.equal(result.processedSize, null)
  assert.equal(result.itemCount, 3)
  assert.equal(result.itemCountSource, 'operation_log')
  assert.equal(execution.splitCleanOperationLog(log).operationLog, '')
})

test('each confirmed operation remains a distinct rendered item without copying scan estimates', () => {
  const log = [start(), record('REMOVED', '/cache/a (8KB)'), record('TRASHED', '/cache/b (batch)'),
    record('REMOVED', '/cache/c (16KB)'), record('FAILED', '/cache/d'), end(2),
  ].join('\n')
  const stdout = 'Cleanup complete\nTracked cleanup: 9.91GB | Items cleaned: 2'
  const preview = { potential_space: 999999, item_count: 999, category_count: 50, sections: [] }
  const result = execution.buildExecutedCleanPreview(preview, summary(stdout, log), execution.combineCleanRawOutput(stdout, log))
  assert.equal(result.potential_space, null)
  assert.equal(result.item_count, 2)
  assert.equal(result.category_count, null)
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].items.length, 3)
  assert.deepEqual(json(result.sections[0].items.map((item) => [item.size, item.count])), [[null, 1], [null, 1], [null, 1]])
})

test('unknown, unavailable logs and a confirmed zero retain separate meanings', () => {
  const unknown = summary('Done')
  assert.equal(unknown.itemCount, null)
  assert.equal(unknown.totalSize, null)
  assert.equal(unknown.processedSize, null)
  assert.equal(unknown.operationLogStatus, 'unavailable')
  const empty = summary('Cleanup complete\nSpace freed: 0B | Items cleaned: 0')
  assert.equal(empty.totalSize, 0)
  assert.equal(empty.itemCount, 0)
  assert.equal(empty.itemCountSource, 'mole')
})

test('operation records expose actions and literal labels without parsing size-like path suffixes', () => {
  const log = ['REMOVED', 'TRASHED', 'FAILED', 'SKIPPED'].map((action) => record(action, '/cache/file (100GB)')).join('\n')
  assert.deepEqual(json(execution.parseCleanOperationLog(log)), ['REMOVED', 'TRASHED', 'FAILED', 'SKIPPED'].map((action) => ({
    action, label: '/cache/file (100GB)', runId: 'anon-1',
  })))
})
