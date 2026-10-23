import assert from 'node:assert/strict'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const types = loadTypeScript('../src/pages/installer/types.ts', {})
const records = loadTypeScript('../src/lib/historyRecords.ts', {})
const en = loadTypeScript('../src/i18n/en.ts', {}).en
const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key] ?? key)
const preview = { scan_status: 'complete', review_token: 'opaque-review', total_size: 100, items: [{ path: '/tmp/App.dmg', name: 'App.dmg', size: 100, source: 'Downloads' }] }

test('installer cleanup requires current native review authority; cached and legacy previews cannot run', () => {
  assert.equal(types.canExecuteInstallerPreview(preview), true)
  assert.equal(types.canExecuteInstallerPreview(types.cachedInstallerPreview(preview)), false)
  assert.equal(types.cachedInstallerPreview(preview).review_token, null)
  assert.equal(types.canExecuteInstallerPreview({ ...preview, scan_status: undefined }), false)
  assert.equal(types.canExecuteInstallerPreview({ ...preview, total_size: NaN }), false)
})

function historyFixture() {
  const state = {
    statistics: { cleanSizeFreed: 300, reportedFreedBytes: 20, cleanItemsRemoved: 7, cleanOperationCount: 2 }, history: [],
    addHistory(record) { state.history.push(record) }, updateStatistics(value) { Object.assign(state.statistics, value) },
  }
  const history = loadTypeScript('../src/pages/installer/installerHistory.ts', {
    '@/stores/app': { useAppStore: { getState: () => state } }, '@/lib/historyRecords': records,
  })
  return { state, history }
}

for (const status of ['unknown', 'failed', 'partial']) {
  test(`${status} installer outcome never falls back to preview bytes or increments released space`, () => {
    const { state, history } = historyFixture()
    history.recordInstallerOutcome({ status, item_count: status === 'partial' ? 1 : null, total_size: status === 'partial' ? 50 : null, failed_count: 1, raw_output: 'Mole output' }, 'Installers', 'Installers', 'Review again')
    assert.equal(state.statistics.reportedFreedBytes, 20)
    assert.equal(state.statistics.cleanSizeFreed, 300)
    assert.equal(state.history[0].cleanupSummary.outcome, status)
    assert.equal(state.history[0].cleanupSummary.sizeKind, status === 'partial' ? 'processed' : 'unknown')
    assert.equal(state.history[0].cleanupSummary.totalSize, status === 'partial' ? 50 : undefined)
    assert.equal(state.history[0].cleanupSummary.failedCount, 1)
    assert.equal(state.history[0].cleanupSummary.skippedCount, undefined)
    assert.equal(state.statistics.cleanItemsRemoved, status === 'partial' ? 8 : 7)
    assert.equal(state.statistics.cleanOperationCount, status === 'partial' ? 3 : 2)
    assert.equal(state.history[0].executed, status === 'partial')
    if (status === 'partial') assert.equal(state.statistics.lastCleaned, state.history[0].timestamp)
    else assert.equal(state.statistics.lastCleaned, undefined)
  })
}

test('confirmed zero stays zero while successful deletion sizes remain processed bytes', () => {
  const { state, history } = historyFixture()
  history.recordInstallerOutcome({ status: 'success', item_count: 0, total_size: 0, failed_count: 0 }, 'Installers', 'Installers', '')
  assert.equal(state.history[0].cleanupSummary.itemCount, 0)
  assert.equal(state.history[0].cleanupSummary.totalSize, 0)
  assert.equal(state.statistics.reportedFreedBytes, 20)
  assert.equal(state.statistics.cleanOperationCount, 2)
  assert.equal(state.statistics.lastCleaned, undefined)
  assert.equal(state.history[0].executed, false)
  assert.equal(state.history[0].cleanupSummary.outcome, 'skipped')
  history.recordInstallerOutcome({ status: 'success', item_count: 2, total_size: 70, failed_count: 0 }, 'Installers', 'Installers', '')
  assert.equal(state.statistics.reportedFreedBytes, 20)
  assert.equal(state.statistics.cleanSizeFreed, 300)
  assert.equal(state.statistics.cleanItemsRemoved, 9)
  assert.equal(state.statistics.cleanOperationCount, 3)
  assert.equal(state.history[1].cleanupSummary.sizeKind, 'processed')
  assert.equal(state.history[1].cleanupSummary.totalSize, 70)
  assert.equal(state.statistics.lastCleaned, state.history[1].timestamp)
})

for (const status of ['success', 'partial']) {
  test(`${status} confirmed deletion count is accumulated even when its size is unavailable`, () => {
    const { state, history } = historyFixture()
    history.recordInstallerOutcome({ status, item_count: 2, total_size: null, failed_count: status === 'partial' ? 1 : 0, raw_output: 'Confirmed deletion count only' }, 'Installers', 'Installers', 'Size unavailable')
    assert.equal(state.statistics.cleanItemsRemoved, 9)
    assert.equal(state.statistics.cleanOperationCount, 3)
    assert.equal(state.statistics.reportedFreedBytes, 20)
    assert.equal(state.statistics.cleanSizeFreed, 300)
    assert.equal(state.history[0].executed, true)
    assert.equal(state.history[0].cleanupSummary.itemCount, 2)
    assert.equal(state.history[0].cleanupSummary.totalSize, undefined)
    assert.equal(state.history[0].cleanupSummary.sizeKind, 'unknown')
    assert.equal(state.history[0].cleanupSummary.outcome, status)
  })
}

for (const itemCount of [null, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`unconfirmed installer count ${itemCount} cannot increase cleanup statistics`, () => {
    const { state, history } = historyFixture()
    history.recordInstallerOutcome({ status: 'partial', item_count: itemCount, total_size: 50, failed_count: 1 }, 'Installers', 'Installers', 'Unknown count')
    assert.equal(state.history[0].executed, false)
    assert.equal(state.history[0].cleanupSummary.itemCount, undefined)
    assert.equal(state.history[0].cleanupSummary.totalSize, undefined)
    assert.equal(state.statistics.cleanItemsRemoved, 7)
    assert.equal(state.statistics.cleanOperationCount, 2)
    assert.equal(state.statistics.reportedFreedBytes, 20)
    assert.equal(state.statistics.lastCleaned, undefined)
  })
}

test('partial size corruption cannot erase its independently confirmed deletion count', () => {
  const { state, history } = historyFixture()
  history.recordInstallerOutcome({ status: 'partial', item_count: 1, total_size: Infinity, failed_count: NaN }, 'Installers', 'Installers', 'Incomplete report')
  assert.equal(state.statistics.cleanItemsRemoved, 8)
  assert.equal(state.statistics.cleanOperationCount, 3)
  assert.equal(state.history[0].cleanupSummary.totalSize, undefined)
  assert.equal(state.history[0].cleanupSummary.failedCount, undefined)
  assert.equal(state.statistics.reportedFreedBytes, 20)
})

test('a failed native report with no deletions stays failed without counting a cleanup operation', () => {
  const { state, history } = historyFixture()
  history.recordInstallerOutcome({ status: 'failed', item_count: 0, total_size: 0, failed_count: 3 }, 'Installers', 'Installers', 'Three failures')
  assert.equal(state.history[0].executed, false)
  assert.equal(state.history[0].cleanupSummary.outcome, 'failed')
  assert.equal(state.history[0].cleanupSummary.itemCount, 0)
  assert.equal(state.history[0].cleanupSummary.failedCount, 3)
  assert.equal(state.statistics.cleanItemsRemoved, 7)
  assert.equal(state.statistics.cleanOperationCount, 2)
  assert.equal(state.statistics.lastCleaned, undefined)
})

test('result component keeps partial and unknown states visible instead of reporting success', () => {
  const component = loadTypeScript('../src/pages/installer/InstallerExecutionResult.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@/i18n': { useI18n: () => ({ t }) },
  })
  const partial = component.InstallerExecutionResult({ result: { status: 'partial', item_count: 2, total_size: 50, failed_count: 1, raw_output: 'Failed to remove 1 installer' } })
  assert.match(renderedText(partial), /partial: 2 confirmed, 1 incomplete/)
  assert.match(renderedText(partial), /Failed to remove 1 installer/)
  const unknown = component.InstallerExecutionResult({ result: { status: 'unknown', item_count: null, total_size: null, failed_count: null, raw_output: 'unrecognized output' } })
  assert.match(renderedText(unknown), /could not be confirmed/)
})

test('legacy empty cached preview does not present unknown scan totals as zero or enable deletion', () => {
  let stateIndex = 0
  const stateValues = [{ total_size: 0, items: [] }, false, false, null, null]
  const mockStore = (selector) => selector({ addHistory() {} })
  const component = loadTypeScript('../src/pages/InstallerPage.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useState: () => [stateValues[stateIndex++], () => {}], useMemo: (fn) => fn(), useEffect: () => {} },
    '@/i18n': { useI18n: () => ({ t }) }, '@/lib/utils': { formatFileSize: (size) => `${size} B` },
    '@/components/ui/badge': { Badge: 'Badge' }, '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((key) => [key, key])),
    '@/lib/historyRecords': records, '@/lib/resultCache': {}, '@/stores/app': { useAppStore: mockStore },
    '@tauri-apps/api/shell': {}, '@tauri-apps/api/tauri': {}, 'react-toastify': { toast: {} },
    'lucide-react': Object.fromEntries(['Archive', 'CheckCircle2', 'Database', 'ExternalLink', 'FolderDown', 'Loader2', 'Package', 'ShieldCheck', 'Trash2'].map((key) => [key, key])),
    './maintenance/MaintenanceScanCard': {}, './maintenance/useMaintenanceScanProgress': { useMaintenanceScanProgress: () => 0 },
    './installer/types': types, './installer/installerHistory': {}, './installer/InstallerExecutionResult': {},
  })
  const tree = component.InstallerPage()
  assert.match(renderedText(tree), /Unknown/)
  assert.match(renderedText(tree), /scanned again before cleanup/)
  assert.doesNotMatch(renderedText(tree), /0 B|No installer leftovers were found/)
  assert.equal(findElements(tree, (node) => node.type === 'Button' && node.props.variant === 'destructive').length, 0)
})
