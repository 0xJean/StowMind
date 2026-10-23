import assert from 'node:assert/strict'
import test from 'node:test'
import { findElement, findElements, jsx, loadTypeScript } from './ios-organizer-test-harness.mjs'

const helpers = loadTypeScript('../src/pages/purge/types.ts', {})
const preview = (path = '/projects/a', includeEmpty = false) => ({
  root: path, requested_root: path, include_empty: includeEmpty,
  items: [{ path: `${path}/target`, size: 8192 }], total_size: 8192,
  size_kind: 'estimated', scan_status: 'complete', review_token: `native-${path}-${includeEmpty}`,
})
const result = (extra = {}) => ({ item_count: 1, total_size: 4096, size_kind: 'estimated', outcome: 'completed', raw_output: 'fixture', ...extra })
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('preview authority is bound to fresh matching scope and never persisted', () => {
  const data = preview()
  const scope = { path: '/projects/a', includeEmpty: false }
  assert.equal(helpers.canExecutePurge(data, scope, true), true)
  assert.equal(helpers.canExecutePurge(data, scope, false), false)
  assert.equal(helpers.canExecutePurge(data, { ...scope, path: '/projects/b' }, true), false)
  assert.equal(helpers.canExecutePurge(data, { ...scope, includeEmpty: true }, true), false)
  const cached = helpers.cacheablePurgePreview(data)
  assert.equal(cached.review_token, null)
  assert.equal(helpers.canExecutePurge(cached, scope, true), false)
  assert.equal(data.review_token, 'native-/projects/a-false')
  assert.equal(helpers.isPurgePreview({ root: data.root, items: data.items, total_size: 8192 }), false)
})

test('execution metrics preserve zero, unknown and partial estimates without using preview totals', () => {
  const zero = helpers.purgeOutcomeMetrics(result({ item_count: 0, total_size: 0, size_kind: 'reported_freed' }))
  assert.equal(zero.itemCount, 0)
  assert.equal(zero.freedBytes, 0)
  assert.equal(zero.hasEvidence, false)
  assert.equal(zero.historyOutcome, 'skipped')
  const unknown = helpers.purgeOutcomeMetrics(result({ item_count: null, total_size: null, size_kind: 'unknown', outcome: 'unknown' }))
  assert.equal(unknown.itemCount, null)
  assert.equal(unknown.reportedSize, null)
  assert.equal(unknown.freedBytes, null)
  assert.equal(unknown.hasEvidence, false)
  assert.equal(unknown.historyOutcome, 'unknown')
  const partial = helpers.purgeOutcomeMetrics(result({ size_kind: 'at_least', outcome: 'incomplete' }))
  assert.equal(partial.itemCount, 1)
  assert.equal(partial.reportedSize, 4096)
  assert.equal(partial.freedBytes, null)
  assert.equal(partial.historyOutcome, 'partial')
  assert.equal(partial.hasEvidence, true)
  const failed = helpers.purgeOutcomeMetrics(result({ outcome: 'failed', size_kind: 'reported_freed' }))
  assert.equal(failed.freedBytes, null)
  assert.equal(failed.sizeKind, 'unknown')
})

function createPage({ cached = null, execution = result(), scanFailure = false, deferCache = false } = {}) {
  const states = [], effects = [], calls = [], history = [], saved = [], deleted = []
  const statistics = { cleanItemsRemoved: 5, reportedFreedBytes: 100, cleanOperationCount: 2 }
  let cursor = 0, resolveCache
  const cachePromise = deferCache ? new Promise((resolve) => { resolveCache = resolve }) : Promise.resolve(cached)
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = { current: initial }
      return states[index]
    },
    useEffect(effect, dependencies) {
      const index = cursor++, previous = states[index]
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) {
        effects.push(() => { previous?.cleanup?.(); states[index] = { dependencies, cleanup: effect() } })
      }
    },
  }
  const store = { statistics, addHistory: (entry) => history.push(entry), updateStatistics: (update) => Object.assign(statistics, update) }
  const useAppStore = Object.assign((select) => select(store), { getState: () => store })
  const { PurgePage } = loadTypeScript('../src/pages/PurgePage.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/ui/button': { Button: 'Button' }, '@/components/ui/input': { Input: 'Input' },
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((name) => [name, name])),
    '@/i18n': { useI18n: () => ({ t: (key) => key }) },
    '@/lib/historyRecords': { createCleanupHistoryRecord: (entry) => entry },
    '@/lib/resultCache': {
      deleteResultSnapshot: async (key) => deleted.push(key),
      loadResultSnapshot: async () => cachePromise,
      resultCacheKeys: { purgePreview: (key) => key },
      saveResultSnapshot: async (key, payload) => saved.push({ key, payload }),
    },
    '@/lib/utils': { formatFileSize: String }, '@/stores/app': { useAppStore },
    '@tauri-apps/api/dialog': { open: async () => null }, '@tauri-apps/api/shell': { open: async () => {} },
    '@tauri-apps/api/tauri': { invoke: async (command, args) => {
      calls.push({ command, args })
      if (command === 'mole_purge_preview') { if (scanFailure) throw new Error('fixture scan failed'); return preview(args.path, args.includeEmpty) }
      if (command === 'mole_purge_execute') return execution
      assert.fail(`Unexpected native command: ${command}`)
    } },
    'lucide-react': Object.fromEntries(['FolderOpen', 'Loader2', 'PackageX', 'Terminal', 'Trash2'].map((name) => [name, name])),
    'react-toastify': { toast: Object.fromEntries(['warning', 'success', 'info', 'error'].map((name) => [name, () => {}])) },
    './maintenance/MaintenanceScanCard': { MaintenanceScanCard: 'MaintenanceScanCard', formatMaintenanceElapsed: String },
    './maintenance/useMaintenanceScanProgress': { useMaintenanceScanProgress: () => 0 },
    './purge/types': helpers,
  }, { window: { confirm: () => true } })
  return {
    calls, history, saved, deleted, statistics, resolveCache,
    render() { cursor = 0; const tree = PurgePage(); effects.splice(0).forEach((effect) => effect()); return tree },
    async scan(path = '/projects/a') {
      findElement(this.render(), 'Input').props.onChange({ target: { value: path } })
      this.render()
      findElement(this.render(), 'MaintenanceScanCard').props.onAction()
      await settle()
      return this.render()
    },
  }
}
const cleanupButton = (tree) => findElements(tree, (item) => item.type === 'Button' && item.props.variant === 'destructive')[0]

test('changing scope rejects a queued cleanup callback and strips native token from cached preview', async () => {
  const page = createPage()
  let tree = await page.scan()
  assert.equal(cleanupButton(tree).props.disabled, false)
  assert.equal(page.saved[0].payload.review_token, null)
  const queued = cleanupButton(tree).props.onClick
  findElement(tree, 'Input').props.onChange({ target: { value: '/projects/b' } })
  queued()
  await settle()
  assert.equal(page.calls.filter((call) => call.command === 'mole_purge_execute').length, 0)
  assert.equal(cleanupButton(page.render()), undefined)
})

test('late cache data cannot overwrite a newly completed scan or authorize cleanup', async () => {
  const page = createPage({ deferCache: true })
  await page.scan()
  page.resolveCache({ payload: preview('/projects/stale') })
  await settle()
  cleanupButton(page.render()).props.onClick()
  await settle()
  const executed = page.calls.find((call) => call.command === 'mole_purge_execute')
  assert.equal(executed.args.path, '/projects/a')
  assert.equal(executed.args.reviewToken, 'native-/projects/a-false')
})

for (const [name, execution, expectedItems, expectedBytes, executed, outcome] of [
  ['estimated', result(), 6, 100, true, 'success'],
  ['actual zero', result({ item_count: 0, total_size: 0, size_kind: 'reported_freed' }), 5, 100, false, 'skipped'],
  ['unknown', result({ item_count: null, total_size: null, size_kind: 'unknown', outcome: 'unknown' }), 5, 100, false, 'unknown'],
  ['reported freed', result({ size_kind: 'reported_freed' }), 6, 4196, true, 'success'],
  ['partial', result({ size_kind: 'at_least', outcome: 'incomplete' }), 6, 100, true, 'partial'],
]) {
  test(`${name} execution records only reported evidence and consumes the review once`, async () => {
    const page = createPage({ execution })
    const tree = await page.scan()
    const click = cleanupButton(tree).props.onClick
    click(); click()
    await settle()
    assert.equal(page.calls.filter((call) => call.command === 'mole_purge_execute').length, 1)
    assert.equal(page.statistics.cleanItemsRemoved, expectedItems)
    assert.equal(page.statistics.reportedFreedBytes, expectedBytes)
    assert.equal(page.statistics.cleanOperationCount, executed ? 3 : 2)
    assert.equal(Boolean(page.statistics.lastCleaned), executed)
    const record = page.history.find((entry) => entry.action === 'execute')
    assert.equal(record.totalSize, execution.total_size)
    assert.equal(record.itemCount, execution.item_count)
    assert.equal(record.executed, executed)
    assert.equal(record.outcome, outcome)
    assert.equal(cleanupButton(page.render()).props.disabled, true)
  })
}

test('failed scans keep retry reachable and cannot leave executable results', async () => {
  const page = createPage({ scanFailure: true })
  const tree = await page.scan()
  assert.ok(findElement(tree, 'MaintenanceScanCard').props.errorMessage)
  assert.equal(cleanupButton(tree), undefined)
  assert.equal(page.saved.length, 0)
})
