import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const execution = loadTypeScript('../src/pages/clean/cleanExecutionResult.ts', {})
const activity = loadTypeScript('../src/lib/stowmind-supplements/cleanupActivity.ts', {})
const en = loadTypeScript('../src/i18n/en.ts', {}).en
const t = (key, values = {}) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), en[key] ?? key)
const bytes = Math.round(9.91 * 1024 ** 3)
const preview = {
  potential_space: 999_999_999_999, item_count: 9_999, category_count: 99,
  summary_status: 'exact', scan_status: 'complete', raw_output: 'Cached preview',
  sections: [{ title: 'Cached estimates', items: [{ label: '/fixture/preview-only', count: 9_999, size: 999_999_999_999, status: 'dry_run' }] }],
}

// Reproduce the observed counts and batch shape, without copying user paths.
function anonymizedLog(run = 'fixture-run') {
  const record = (action, label, index) => `[${new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()}] [clean run=${run}] ${action} ${label}`
  return [
    `# ========== clean run=${run} session started at 2026-01-01 00:00:00 ==========`,
    ...Array.from({ length: 946 }, (_, i) => record('REMOVED', `/fixture/cache/item-${i}${i < 20 ? ' (batch)' : ' (8KB)'}`, i + 1)),
    ...Array.from({ length: 173 }, (_, i) => record('SKIPPED', `/fixture/cache/protected-${i % 169} (whitelist)`, i + 947)),
    ...Array.from({ length: 4 }, (_, i) => record('FAILED', `/fixture/cache/failed-${i} (permission denied)`, i + 1120)),
    `# ========== clean run=${run} session ended at 2026-01-01 01:00:00, 511 items, 9.91GB ==========`,
  ].join('\n')
}
const log = anonymizedLog()
const stdout = 'Diagnostic before cleanup\nCleanup complete\nTracked cleanup: 9.91GB | Items cleaned: 511\nFree space: 42GB (+1GB)'

function complete(rawOutput = stdout, operationLog = log, status = 'completed') {
  const state = {
    history: [], statistics: { cleanItemsRemoved: 7, cleanSizeFreed: 99, reportedFreedBytes: 99, cleanOperationCount: 2 },
    addHistory(record) { this.history.push(record) },
    updateStatistics(value) { Object.assign(this.statistics, value) },
  }
  const completion = loadTypeScript('../src/pages/clean/cleanCompletion.ts', {
    '@/stores/app': { useAppStore: { getState: () => state } }, './cleanExecutionResult': execution,
  })
  const result = completion.recordCleanCompletion({
    status, previewToArchive: preview, rawOutput, operationLog, outputLines: [], startedAt: Date.now(),
  }, t)
  return { result, state, history: state.history[0] }
}

function assertObservedSummary(summary) {
  assert.equal(summary.itemCount, 511)
  assert.equal(summary.itemCountSource, 'mole')
  assert.equal(summary.processedSize, bytes)
  assert.equal(summary.totalSize, null)
  assert.equal(summary.operationCount, 946)
  assert.equal(summary.failedCount, 4)
  assert.equal(summary.skippedCount, 173)
  assert.equal(summary.operationLogStatus, 'available')
}

test('large anonymous ledger preserves Mole totals, repeated skip events and batch operation counts', () => {
  const summary = execution.summarizeCleanExecution(log.split('\n'), execution.combineCleanRawOutput(stdout, log), log)
  assertObservedSummary(summary)
  assert.equal(summary.processedSizeKind, 'reported')
  const records = execution.parseCleanOperationLog(log)
  assert.equal(records.length, 1123)
  assert.equal(records.filter((record) => record.action === 'REMOVED' && record.label.endsWith('(batch)')).length, 20)
  assert.equal(new Set(records.filter((record) => record.action === 'SKIPPED').map((record) => record.label)).size, 169)
})

test('four failed operations downgrade completion and history while processed bytes never enter freed totals', () => {
  const { result, state, history } = complete()
  assertObservedSummary(result.summary)
  assert.equal(result.status, 'partial')
  assert.equal(history.executed, true)
  assert.equal(history.cleanupSummary.outcome, 'partial')
  assert.equal(history.cleanupSummary.itemCount, 511)
  assert.equal(history.cleanupSummary.itemCountSource, 'mole')
  assert.equal(history.cleanupSummary.operationCount, 946)
  assert.equal(history.cleanupSummary.failedCount, 4)
  assert.equal(history.cleanupSummary.skippedCount, 173)
  assert.equal(history.cleanupSummary.errors.length, 4)
  assert.equal(history.cleanupSummary.sizeKind, 'processed')
  assert.equal(history.cleanupSummary.processedSize, bytes)
  assert.equal(state.statistics.cleanItemsRemoved, 518)
  assert.equal(state.statistics.cleanOperationCount, 3)
  assert.equal(state.statistics.cleanSizeFreed, 99)
  assert.equal(state.statistics.reportedFreedBytes, 99)
  assert.equal(activity.cleanupFreedSize(history), 0)
  assert.equal(activity.cleanupProcessedSize(history), bytes)
  assert.equal(activity.buildCleanupActivitySummary([history], state.statistics).totalFreed, 99)
  assert.equal(result.preview.potential_space, null)
  assert.equal(result.preview.category_count, null)
  assert.equal(result.preview.sections[0].items.length, 946)
})

test('footer replay retains its unspecified completeness through history', () => {
  const { result, history } = complete('', log)
  assertObservedSummary(result.summary)
  assert.equal(result.summary.processedSizeKind, 'unspecified')
  assert.equal(history.cleanupSummary.processedSizeKind, 'unspecified')
  assert.equal(history.cleanupSummary.sizeKind, 'processed')
  assert.equal(result.status, 'partial')
})

test('a rounded footer cannot upgrade lower-bound or partially measured final output', () => {
  for (const [value, kind, expected] of [['At least 9.91GB', 'at_least', bytes], ['Partially measured', 'partial', null]]) {
    const { result, history, state } = complete(`Cleanup complete\nTracked cleanup: ${value} | Items cleaned: 511`, log)
    assert.equal(result.summary.processedSizeKind, kind)
    assert.equal(result.summary.processedSize, expected)
    assert.equal(history.cleanupSummary.processedSizeKind, kind)
    assert.equal(history.cleanupSummary.processedSize, expected ?? undefined)
    assert.equal(result.summary.totalSize, null)
    assert.equal(state.statistics.reportedFreedBytes, 99)
  }
})

test('unknown execution cannot reuse cached preview quantities or categories in history and lifetime totals', () => {
  const { result, history, state } = complete('Cleanup interrupted\nNo final report.', '')
  assert.equal(result.summary.itemCount, null)
  assert.equal(result.summary.processedSize, null)
  assert.equal(result.summary.totalSize, null)
  assert.equal(result.preview.sections.length, 0)
  assert.equal(result.preview.category_count, null)
  assert.equal(history.executed, false)
  assert.equal(history.cleanupSummary.outcome, 'unknown')
  assert.equal(history.cleanupSummary.itemCount, undefined)
  assert.equal(history.cleanupSummary.totalSize, undefined)
  assert.equal(Object.keys(history.categories).length, 0)
  assert.equal(state.statistics.cleanOperationCount, 2)
  assert.equal(state.statistics.cleanItemsRemoved, 7)
  assert.equal(state.statistics.reportedFreedBytes, 99)
})

test('unattributable concurrent logs cannot borrow another run footer or hide attribution failure behind a successful stdout', () => {
  const mixed = `${log}\n${anonymizedLog('another-run')}`
  const unknown = complete('Cleanup complete', mixed)
  assert.equal(unknown.result.summary.operationLogStatus, 'ambiguous')
  assert.equal(unknown.result.summary.itemCount, null)
  assert.equal(unknown.result.summary.processedSize, null)
  assert.equal(unknown.history.executed, false)
  assert.equal(unknown.history.cleanupSummary.outcome, 'unknown')
  assert.equal(unknown.result.preview.sections.length, 0)
  const ownSummary = complete(stdout, mixed)
  assert.equal(ownSummary.result.summary.itemCount, 511)
  assert.equal(ownSummary.result.summary.operationCount, 0)
  assert.equal(ownSummary.result.status, 'partial')
  assert.equal(ownSummary.history.cleanupSummary.outcome, 'partial')
  assert.equal(ownSummary.state.statistics.reportedFreedBytes, 99)
})

test('a failure-only ledger cannot become a successful cleanup operation', () => {
  const { result, history, state } = complete('Cleanup incomplete', '[clean run=failed-run] FAILED /fixture/cache/denied (permission denied)')
  assert.equal(result.status, 'failed')
  assert.equal(history.cleanupSummary.outcome, 'failed')
  assert.equal(history.executed, false)
  assert.equal(state.statistics.cleanOperationCount, 2)
  assert.equal(state.statistics.cleanItemsRemoved, 7)
})

test('nonzero command exit preserves confirmed successful work as partial even without a FAILED log record', () => {
  const successfulLog = '[clean run=interrupted-run] REMOVED /fixture/cache/finished (batch)'
  const { result, history, state } = complete('Cleanup incomplete\nTracked cleanup: At least 1GB | Items cleaned: 2', successfulLog, 'failed')
  assert.equal(result.summary.failedCount, 0)
  assert.equal(result.status, 'partial')
  assert.equal(history.executed, true)
  assert.equal(history.cleanupSummary.outcome, 'partial')
  assert.equal(history.cleanupSummary.itemCount, 2)
  assert.equal(history.cleanupSummary.operationCount, 1)
  assert.equal(history.cleanupSummary.sizeKind, 'processed')
  assert.equal(history.cleanupSummary.processedSizeKind, 'at_least')
  assert.equal(state.statistics.cleanOperationCount, 3)
  assert.equal(state.statistics.cleanItemsRemoved, 9)
  assert.equal(state.statistics.reportedFreedBytes, 99)
})

test('nonzero command exit without execution evidence remains failed and cannot reuse its preview', () => {
  const { result, history, state } = complete('Cannot start cleanup command', '', 'failed')
  assert.equal(result.status, 'failed')
  assert.equal(history.executed, false)
  assert.equal(history.cleanupSummary.outcome, 'failed')
  assert.equal(history.cleanupSummary.itemCount, undefined)
  assert.equal(history.cleanupSummary.totalSize, undefined)
  assert.equal(result.preview.sections.length, 0)
  assert.equal(state.statistics.cleanOperationCount, 2)
  assert.equal(state.statistics.cleanItemsRemoved, 7)
  assert.equal(state.statistics.reportedFreedBytes, 99)
})

function renderCompleted(result) {
  const common = {
    react: { useMemo: (fn) => fn(), useState: (initial) => [initial, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/i18n': { useI18n: () => ({ t }) }, '@/lib/utils': { formatFileSize: (value) => `${value} B` },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((name) => [name, name])),
    'lucide-react': Object.fromEntries(['AlertCircle', 'Ban', 'CheckCircle2', 'Clock', 'Database', 'Files', 'RefreshCw', 'ChevronDown', 'ChevronRight', 'SkipForward'].map((name) => [name, name])),
  }
  const panel = loadTypeScript('../src/pages/clean/CleanCompletedPanel.tsx', {
    ...common, './cleanExecutionResult': execution,
    './CleanScanStatusPanel': { formatElapsed: String },
    './CleanOperationLogPanel': loadTypeScript('../src/pages/clean/CleanOperationLogPanel.tsx', common),
    './CleanExecutionOutputPanel': loadTypeScript('../src/pages/clean/CleanExecutionOutputPanel.tsx', common),
  })
  const expand = (element) => {
    if (Array.isArray(element)) return element.map(expand)
    if (!element || typeof element !== 'object') return element
    if (typeof element.type === 'function') return expand(element.type(element.props))
    return { ...element, props: { ...element.props, children: expand(element.props?.children) } }
  }
  // Omit summary to exercise the real panel-to-parser fallback, not a stub DTO.
  return expand(panel.CleanCompletedPanel({ ...result, summary: undefined, preview, onRescan() {} }))
}

test('real completion parser and rendered panel agree on partial status and retain all four failed diagnostics', () => {
  const tree = renderCompleted(complete().result)
  const cards = findElements(tree, (element) => element.type === 'Card')
  assert.match(cards[0].props.className, /yellow/)
  assert.equal(findElements(cards[0], (element) => element.type === 'CheckCircle2').length, 0)
  const title = findElements(tree, (element) => element.type === 'CardTitle' && element.props.className === 'text-3xl')[0]
  assert.equal(renderedText(title), t('clean.result.partialTitle'))
  const metrics = findElements(tree, (element) => element.props?.className === 'iqon-row p-4')
  const metric = (key) => renderedText(metrics.find((element) => renderedText(element).includes(t(key))))
  assert.match(metric('clean.result.moleItems'), /511/)
  assert.match(metric('clean.result.logItems'), /946/)
  assert.ok(metric('clean.result.freedSize').includes(t('clean.result.notReported')))
  assert.match(metric('clean.result.processedSize'), new RegExp(String(bytes)))
  assert.equal(findElements(tree, (element) => element.type === 'li').length, 4)
  assert.doesNotMatch(renderedText(tree), /999999999999|preview-only/)
})

test('real rendered fallback keeps a footer-only value qualified instead of labelling it precise freed space', () => {
  const tree = renderCompleted(complete('', log).result)
  assert.ok(renderedText(tree).includes(t('clean.result.processedUnspecified')))
  assert.ok(renderedText(tree).includes(t('clean.result.notReported')))
})

// Opt-in local evidence replay. Neither the file nor its private labels enter
// fixtures or test output; assertions intentionally inspect only numeric fields.
test('opt-in private operation ledger reproduces the observed numeric result', { skip: !process.env.STOWMIND_CLEAN_REPLAY_LOG }, () => {
  const privateLog = readFileSync(process.env.STOWMIND_CLEAN_REPLAY_LOG, 'utf8')
  const { result, history, state } = complete('', privateLog)
  assertObservedSummary(result.summary)
  assert.equal(result.summary.processedSizeKind, 'unspecified')
  assert.equal(result.status, 'partial')
  assert.equal(history.cleanupSummary.outcome, 'partial')
  assert.equal(state.statistics.reportedFreedBytes, 99)
})
