import assert from 'node:assert/strict'
import test from 'node:test'
import { findElement, jsx, loadTypeScript } from './ios-organizer-test-harness.mjs'

const settle = () => new Promise((resolve) => setImmediate(resolve))
const initialStatistics = {
  cleanItemsRemoved: 7, cleanOperationCount: 2, cleanSizeFreed: 300,
  reportedFreedBytes: 20, lastCleaned: '2026-01-01T00:00:00.000Z',
}
const preview = {
  potential_space: 30 * 1024 ** 3, item_count: 890, category_count: 6,
  summary_status: 'at_least', scan_status: 'complete',
  sections: [{ title: 'Preview caches', items: [{ label: 'Unexecuted scan estimate', status: 'dry_run', size: 30 * 1024 ** 3, count: 890 }] }],
  raw_output: 'Dry run complete\nPotential space: At least 30GB | Items: 890 | Categories: 6',
}
const partialLog = [
  '# ========== clean run=anonymous-1 session started at 2026-01-01 10:00:00 ==========',
  '[2026-01-01 10:00:01] [clean run=anonymous-1] REMOVED /cache/confirmed-a (8KB)',
  '[2026-01-01 10:00:02] [clean run=anonymous-1] REMOVED /cache/confirmed-b (batch)',
  ...Array.from({ length: 4 }, (_, index) => `[2026-01-01 10:00:0${index + 3}] [clean run=anonymous-1] FAILED /cache/failed-${index} (permission denied)`),
  '# ========== clean run=anonymous-1 session ended at 2026-01-01 10:01:00, 2 items, 1GB ==========',
].join('\n')
const partialOutput = 'Cleanup complete\nTracked cleanup: At least 1GB | Items cleaned: 2\nFree space: 100GB (+1GB)'

// Run the page's real callbacks, parser, completion recorder and cache adapter.
// Only React scheduling, persisted state and native IPC are replaced.
function createPage(execute, { restore = false } = {}) {
  const states = [], effects = [], calls = [], notices = [], history = []
  const listeners = new Map()
  let cursor = 0
  let persisted = restore ? {
    key: 'mole.clean.preview', schemaVersion: 1,
    payload: {
      id: 'pending-reviewed', status: 'pending', createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z', externalPath: null, preview,
    },
  } : null
  const state = {
    statistics: { ...initialStatistics },
    addHistory: (record) => history.push(record),
    updateStatistics: (update) => Object.assign(state.statistics, update),
  }
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = { current: initial }
      return states[index]
    },
    useMemo(compute, dependencies) {
      const index = cursor++
      if (!states[index] || dependencies.some((value, offset) => value !== states[index].dependencies[offset])) {
        states[index] = { dependencies, value: compute() }
      }
      return states[index].value
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      const previous = states[index]
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) {
        effects.push(() => {
          previous?.cleanup?.()
          states[index] = { dependencies, cleanup: effect() }
        })
      }
    },
  }
  const invoke = async (command, args) => {
    calls.push({ command, args })
    if (command === 'result_cache_load') return persisted
    if (command === 'result_cache_save') { persisted = args.snapshot; return }
    if (command === 'result_cache_delete') { persisted = null; return }
    if (command === 'mole_clean_preview_pty') return preview
    if (command === 'mole_clean_execute_pty') return execute(args, (line, runId = args.runId) => {
      listeners.get('mole-clean-preview-output')?.({ payload: { run_id: runId, stream: 'stdout', line } })
    })
    assert.fail(`No real cleanup or unexpected IPC is allowed: ${command}`)
  }
  const execution = loadTypeScript('../src/pages/clean/cleanExecutionResult.ts', {})
  const completion = loadTypeScript('../src/pages/clean/cleanCompletion.ts', {
    '@/stores/app': { useAppStore: { getState: () => state } }, './cleanExecutionResult': execution,
  })
  const resultCache = loadTypeScript('../src/lib/resultCache.ts', { '@tauri-apps/api/tauri': { invoke } })
  const snapshots = loadTypeScript('../src/pages/clean/cleanScanSnapshot.ts', { '@/lib/resultCache': resultCache })
  const summary = loadTypeScript('../src/pages/clean/cleanPreviewSummary.ts', { '@/lib/utils': { formatFileSize: String } })
  const types = loadTypeScript('../src/pages/clean/types.ts', {})
  const components = Object.fromEntries([
    'CleanCompletedPanel', 'CleanInteractionPrompt', 'PendingCleanScanCard',
    'CleanResultsPanel', 'CleanScopeControls', 'CleanScanCard',
  ].map((name) => [`./clean/${name}`, { [name]: name }]))
  const { CleanPage } = loadTypeScript('../src/pages/CleanPage.tsx', {
    ...components, react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/ui/card': { Card: 'Card', CardContent: 'CardContent' },
    '@/i18n': { useI18n: () => ({ t: (key) => key }) },
    '@tauri-apps/api/tauri': { invoke },
    '@tauri-apps/api/event': { listen: async (name, callback) => {
      listeners.set(name, callback)
      return () => listeners.delete(name)
    } },
    'lucide-react': { ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight', FileText: 'FileText' },
    'react-toastify': { toast: Object.fromEntries(['warning', 'success', 'info', 'error']
      .map((kind) => [kind, (message) => notices.push({ kind, message })])) },
    './clean/cleanScanSnapshot': snapshots, './clean/cleanPreviewSummary': summary,
    './clean/types': types, './clean/cleanExecutionResult': execution, './clean/cleanCompletion': completion,
    './clean/cleanFailureHints': { hasDiskAccessFailure: () => false },
    './clean/useCleanPtyInteraction': { useCleanPtyInteraction: () => ({ reset() {}, open() {}, submit() {}, cancel() {}, setValue() {} }) },
  }, { window: { setInterval: () => 1, clearInterval() {} } })
  return {
    calls, notices, history, listeners, statistics: state.statistics,
    saved: () => persisted,
    executions: () => calls.filter(({ command }) => command === 'mole_clean_execute_pty'),
    render() {
      cursor = 0
      const tree = CleanPage()
      effects.splice(0).forEach((effect) => effect())
      return tree
    },
    async review() {
      this.render()
      await settle()
      if (restore) findElement(this.render(), 'PendingCleanScanCard').props.onView()
      else {
        findElement(this.render(), 'CleanScanCard').props.onScan()
        await settle()
      }
      assert.ok(this.saved(), 'A reviewed scan must be persisted before execution')
      const panel = findElement(this.render(), 'CleanResultsPanel')
      assert.equal(panel.props.preview, preview)
      this.notices.length = 0
      return panel
    },
    async complete() {
      await settle()
      const tree = this.render()
      const panel = findElement(tree, 'CleanCompletedPanel')
      assert.ok(panel, 'The real runClean callback must reach the completion UI')
      assert.equal(this.executions().length, 1)
      assert.equal(this.listeners.size, 0, 'Execution listeners are released in finally')
      assert.equal(this.saved(), null, 'A completed or interrupted run invalidates its cached preview')
      assert.equal(findElement(tree, 'CleanResultsPanel'), null)
      assert.equal(findElement(tree, 'PendingCleanScanCard'), null)
      assert.equal(this.history.length, 1)
      return panel.props
    },
  }
}

function assertConfirmedPartial(page, completed) {
  assert.equal(completed.status, 'partial')
  assert.equal(completed.summary.itemCount, 2)
  assert.equal(completed.summary.operationCount, 2)
  assert.equal(completed.summary.failedCount, 4)
  assert.equal(completed.summary.processedSize, 1024 ** 3)
  assert.equal(completed.summary.processedSizeKind, 'at_least')
  assert.equal(completed.summary.totalSize, null)
  assert.equal(completed.preview.potential_space, null)
  assert.equal(completed.preview.item_count, 2)
  assert.equal(completed.preview.sections[0].items.length, 2)
  assert.equal(completed.preview.sections[0].items.some(({ label }) => label === 'Unexecuted scan estimate'), false)
  const record = page.history[0]
  assert.equal(record.executed, true)
  assert.equal(record.cleanupSummary.outcome, 'partial')
  assert.equal(record.cleanupSummary.itemCount, 2)
  assert.equal(record.cleanupSummary.failedCount, 4)
  assert.equal(record.cleanupSummary.sizeKind, 'processed')
  assert.equal(record.cleanupSummary.errors.length, 4)
  assert.equal(page.statistics.cleanItemsRemoved, initialStatistics.cleanItemsRemoved + 2)
  assert.equal(page.statistics.cleanOperationCount, initialStatistics.cleanOperationCount + 1)
  assert.equal(page.statistics.cleanSizeFreed, initialStatistics.cleanSizeFreed)
  assert.equal(page.statistics.reportedFreedBytes, initialStatistics.reportedFreedBytes)
  assert.notEqual(page.statistics.lastCleaned, initialStatistics.lastCleaned)
}

test('CleanPage warns and completes as partial when successful IPC contains four failed operations', async () => {
  const page = createPage(async (_args, emit) => {
    // Duplicate live evidence is common; foreign runs must not reach the parser.
    emit(partialLog.split('\n')[1])
    emit('[clean run=foreign-2] REMOVED /foreign/cache (1GB)', 'unrelated-ui-run')
    return { raw_output: partialOutput, operation_log: partialLog }
  })
  const reviewed = await page.review()
  reviewed.props.onClean()
  const completed = await page.complete()
  assertConfirmedPartial(page, completed)
  assert.deepEqual(page.notices, [{ kind: 'warning', message: 'clean.result.recordedPartial' }])
  assert.ok(completed.rawOutput.includes('Mole operation log:\n'))
  assert.equal(completed.rawOutput.includes('/foreign/cache'), false)
})

test('CleanPage preserves confirmed partial work from rejected IPC and discards the restored scan', async () => {
  const message = `mo clean failed with exit code 2\n${partialOutput.replace('Cleanup complete', 'Cleanup incomplete')}\n\nMole operation log:\n${partialLog}`
  const page = createPage(async () => { throw message }, { restore: true })
  const reviewed = await page.review()
  reviewed.props.onClean()
  const completed = await page.complete()
  assertConfirmedPartial(page, completed)
  assert.deepEqual(page.notices, [{ kind: 'error', message: 'clean.cleanFail' }])
  assert.ok(completed.rawOutput.includes('mo clean failed with exit code 2'))
  assert.ok(completed.rawOutput.includes('/cache/confirmed-b'))
  assert.equal(page.calls.some(({ command }) => command === 'mole_clean_preview_pty'), false,
    'Restoring a scan and preserving a partial result must not trigger an implicit rescan')
  completed.onRescan()
  await settle()
  assert.equal(page.executions().length, 1, 'Retry offers a new scan, never automatic re-execution')
  assert.equal(page.calls.filter(({ command }) => command === 'mole_clean_preview_pty').length, 1)
  assert.ok(findElement(page.render(), 'CleanResultsPanel'))
})

test('CleanPage records startup failure without counting a saved preview as executed work', async () => {
  const page = createPage(async () => { throw 'Failed to spawn mo clean in PTY: executable unavailable' }, { restore: true })
  const reviewed = await page.review()
  reviewed.props.onClean()
  const completed = await page.complete()
  assert.equal(completed.status, 'failed')
  assert.equal(completed.summary.itemCount, null)
  assert.equal(completed.summary.itemCountSource, 'unknown')
  assert.equal(completed.summary.totalSize, null)
  assert.equal(completed.summary.processedSize, null)
  assert.equal(completed.summary.operationCount, 0)
  assert.equal(completed.summary.operationLogStatus, 'unavailable')
  assert.equal(completed.preview.item_count, null)
  assert.equal(completed.preview.potential_space, null)
  assert.equal(completed.preview.sections.length, 0)
  assert.equal(page.history[0].executed, false)
  assert.equal(page.history[0].cleanupSummary.outcome, 'failed')
  assert.equal(page.history[0].cleanupSummary.itemCount, undefined)
  assert.equal(page.history[0].cleanupSummary.totalSize, undefined)
  assert.deepEqual(page.statistics, initialStatistics)
  assert.deepEqual(page.notices, [{ kind: 'error', message: 'clean.cleanFail' }])
})
