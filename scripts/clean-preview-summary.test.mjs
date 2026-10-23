import assert from 'node:assert/strict'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const en = loadTypeScript('../src/i18n/en.ts', {}).en
const t = (key, values = {}) => Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), en[key] ?? key)
const formatFileSize = (value) => `${value} B`
const summary = loadTypeScript('../src/pages/clean/cleanPreviewSummary.ts', { '@/lib/utils': { formatFileSize } })
const execution = loadTypeScript('../src/pages/clean/cleanExecutionResult.ts', {})
const preview = {
  potential_space: 30_900, item_count: 890, category_count: 6,
  summary_status: 'at_least', scan_status: 'complete',
  sections: [
    { title: 'Caches', items: [{ label: 'User cache', status: 'dry_run', size: 22_770, count: 445 }] },
    { title: 'Developer tools', items: [{ label: 'Developer cache', status: 'dry_run', size: 6_550, count: null }] },
    { title: 'Retained', items: [{ label: 'Protected cache', status: 'skipped', size: 999_999, count: 50 }] },
  ], raw_output: 'Potential space: At least 30.90GB | Items: 890 | Categories: 6',
}
const react = { useState: (value) => [value, () => {}], useEffect: () => {}, useMemo: (fn) => fn() }
const common = {
  'react/jsx-runtime': { jsx, jsxs: jsx }, react,
  '@/i18n': { useI18n: () => ({ t, locale: 'en' }) },
  '@/lib/utils': { formatFileSize, cn: (...parts) => parts.join(' ') },
  '@/components/ui/button': { Button: 'Button' },
  '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((name) => [name, name])),
  './cleanPreviewSummary': summary,
}
const resultsPanel = loadTypeScript('../src/pages/clean/CleanResultsPanel.tsx', {
  ...common, '@/components/ui/badge': { Badge: 'Badge' },
  'lucide-react': { ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight', FileText: 'FileText', Trash2: 'Trash2' },
})
const scanPanel = loadTypeScript('../src/pages/clean/CleanScanCard.tsx', {
  ...common,
  '@/components/ScanAtlasVisual': { ScanAtlasVisual: 'ScanAtlasVisual' },
  'lucide-react': { AlertCircle: 'AlertCircle', Ban: 'Ban', RefreshCw: 'RefreshCw', Trash2: 'Trash2' },
  './cleanFailureHints': {},
  './cleanProgress': { findLatestProgress: () => null, findLatestStep: () => null },
  './CleanScanStatusPanel': { CleanScanStatusPanel: 'CleanScanStatusPanel', formatElapsed: String },
})
const renderScan = (value) => scanPanel.CleanScanCard({
  preview: value, loading: false, scanError: null, scanIdle: false,
  scanElapsedMs: 0, scanIdleMs: 0, scanOutput: [], onScan() {}, onClean() {},
})
const oldZero = { ...preview, potential_space: 0, item_count: 0, category_count: 0, summary_status: undefined, scan_status: undefined }

test('Mole lower-bound totals remain authoritative over incomplete detail counts', () => {
  const next = summary.cleanPreviewLabels(preview, t)
  assert.equal(next.sizeLabel, 'At least 30900 B')
  assert.equal(next.countLabel, 890)
  assert.equal(next.categoriesLabel, 6)
  assert.equal(next.canClean, true)
})

test('legacy zero totals with real detail rows remain visible but cannot authorize cleaning', () => {
  const next = summary.cleanPreviewLabels(oldZero, t)
  assert.equal(next.sizeLabel, 'Reported details: 29320 B')
  assert.equal(next.countLabel, 445)
  assert.equal(next.categoriesLabel, 2)
  assert.equal(next.canClean, false)
  assert.equal(next.empty, false)
})

test('detail sums may exceed the global bound without replacing it or claiming an exact total', () => {
  const next = summary.cleanPreviewLabels({ ...preview, sections: [...preview.sections, { title: 'Overlapping report', items: [{ label: 'Duplicate coverage', status: 'dry_run', size: 20_000 }] }] }, t)
  assert.equal(next.sizeLabel, 'At least 30900 B')
  assert.equal(next.canClean, true)
})

test('known complete zero is empty while absent, partial or invalid summaries remain unknown', () => {
  const empty = { ...preview, potential_space: 0, item_count: 0, category_count: 0, summary_status: 'exact', sections: [] }
  assert.equal(summary.getCleanPreviewSummary(empty).empty, true)
  assert.equal(summary.getCleanPreviewSummary(empty).canClean, false)
  for (const changed of [
    { potential_space: null, item_count: null, category_count: null, summary_status: 'unavailable', sections: [] },
    { scan_status: 'incomplete' }, { scan_status: 'unknown' },
    { potential_space: NaN }, { potential_space: -1 }, { item_count: null },
  ]) {
    const result = summary.getCleanPreviewSummary({ ...preview, ...changed })
    assert.equal(result.canClean, false)
    assert.equal(result.empty, false)
  }
})

test('results and scan cards agree on lower bounds and have no fake selection controls', () => {
  const result = resultsPanel.CleanResultsPanel({ preview, sections: preview.sections, onClean() {} })
  assert.match(renderedText(result), /At least 30900 B/)
  assert.match(renderedText(result), /890 items/)
  assert.doesNotMatch(renderedText(result), /Selected|445\/890|445\/0/)
  assert.equal(findElements(result, (element) => element.type === 'input').length, 0)
  assert.equal(findElements(result, (element) => element.type === 'Button')[0].props.disabled, false)
  assert.match(renderedText(renderScan(preview)), /At least 30900 B/)
})

test('every rendered clean action is disabled for legacy or unknown results, with a visible rescan', () => {
  for (const candidate of [oldZero, { ...preview, summary_status: 'unavailable', potential_space: null }]) {
    const result = resultsPanel.CleanResultsPanel({ preview: candidate, sections: candidate.sections, onClean() {} })
    assert.equal(findElements(result, (element) => element.type === 'Button')[0].props.disabled, true)
    const scan = renderScan(candidate)
    const buttons = findElements(scan, (element) => element.type === 'Button')
    assert.equal(buttons[0].props.disabled, true)
    assert.match(renderedText(buttons[1]), /Scan again/)
    assert.match(renderedText(scan), /scan again before cleaning/)
  }
})

test('execution never converts preview size or progress into confirmed released bytes', () => {
  for (const lines of [[], ['[progress] 890/890']]) {
    const result = execution.summarizeCleanExecution(lines, '', '')
    assert.equal(result.totalSize, null)
    assert.equal(result.itemCount, null)
  }
  const log = '[clean] REMOVED /cache/file 100MB'
  const result = execution.summarizeCleanExecution([log], log, log)
  assert.equal(result.itemCount, 1)
  assert.equal(result.totalSize, null)
  const actual = execution.summarizeCleanExecution([], 'Space freed: 1GB | Items cleaned: 2', '')
  assert.equal(actual.itemCount, 2)
  assert.equal(actual.totalSize, 1024 ** 3)
  const tracked = execution.summarizeCleanExecution([], 'Tracked cleanup: At least 2GB | Items cleaned: 12', '# ========== clean run=20261023-123-45 session ended at 2026-10-23, 12 items, 2GB ==========')
  assert.equal(tracked.itemCount, 12)
  assert.equal(tracked.totalSize, null, 'Tracked cleanup and session sizes are not freed-space measurements')
  const filename = execution.summarizeCleanExecution([], '[clean run=20261023-123-45] REMOVED /cache/Space freed: 100GB', '')
  assert.equal(filename.totalSize, null)
  assert.equal(filename.itemCount, 1)
  assert.equal(execution.summarizeCleanExecution([], 'Estimated space freed: 1GB', '').totalSize, null)
})

test('unknown execution metrics stay absent in history and cannot increase lifetime statistics', () => {
  const state = {
    statistics: { cleanItemsRemoved: 7, cleanSizeFreed: 99, cleanOperationCount: 2 }, history: [],
    addHistory(record) { this.history.push(record) }, updateStatistics(value) { Object.assign(this.statistics, value) },
  }
  const completion = loadTypeScript('../src/pages/clean/cleanCompletion.ts', {
    '@/stores/app': { useAppStore: { getState: () => state } }, './cleanExecutionResult': execution,
  })
  const result = completion.recordCleanCompletion({ status: 'completed', previewToArchive: preview, rawOutput: 'Done', outputLines: [], operationLog: '', startedAt: Date.now() }, t)
  assert.equal(result.preview.potential_space, null)
  assert.equal(state.statistics.cleanSizeFreed, 99)
  assert.equal(state.statistics.cleanItemsRemoved, 7)
  assert.equal(state.history[0].cleanupSummary.totalSize, undefined)
  assert.equal(state.history[0].cleanupSummary.itemCount, undefined)
  assert.ok(state.history[0].cleanupSummary.errors.length)
  assert.equal(state.history[0].executed, false)
  assert.equal(state.history[0].cleanupSummary.outcome, 'unknown')
  assert.equal(state.statistics.cleanOperationCount, 2)
})
