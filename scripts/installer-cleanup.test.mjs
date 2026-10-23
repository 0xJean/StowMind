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
    assert.equal(state.history[0].cleanupSummary.sizeKind, 'unknown')
    assert.equal(state.history[0].cleanupSummary.totalSize, status === 'partial' ? 50 : undefined)
  })
}

test('confirmed zero stays zero while genuine Mole freed bytes update the latest statistics', () => {
  const { state, history } = historyFixture()
  history.recordInstallerOutcome({ status: 'success', item_count: 0, total_size: 0, failed_count: 0 }, 'Installers', 'Installers', '')
  assert.equal(state.history[0].cleanupSummary.itemCount, 0)
  assert.equal(state.history[0].cleanupSummary.totalSize, 0)
  assert.equal(state.statistics.reportedFreedBytes, 20)
  history.recordInstallerOutcome({ status: 'success', item_count: 2, total_size: 70, failed_count: 0 }, 'Installers', 'Installers', '')
  assert.equal(state.statistics.reportedFreedBytes, 90)
  assert.equal(state.statistics.cleanItemsRemoved, 9)
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
