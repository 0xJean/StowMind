import assert from 'node:assert/strict'
import test from 'node:test'
import { findElement, findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const history = loadTypeScript('../src/lib/historyRecords.ts', {})
const t = (key, values = {}) => `${key}${Object.keys(values).length ? ` ${JSON.stringify(values)}` : ''}`
const settle = () => new Promise((resolve) => setImmediate(resolve))
const app = { name: 'Example', bundle_id: 'test.example', source: 'local', uninstall_name: 'Example', path: '/Applications/Example.app', size: '1GB', size_bytes: 1024 ** 3 }
const health = {
  health_score: null, memory_used_gb: null, memory_total_gb: null, disk_used_gb: null,
  disk_total_gb: null, disk_used_percent: null, uptime_days: null, platform: 'macos',
  active_whitelist: [], preview_status: 'complete', planned_count: 9, raw_output: '',
  optimizations: [{ name: 'Cache', category: 'Maintenance', description: 'Review', action: 'cache', safe: false }],
}
function fixture() {
  const records = []
  const notices = []
  const calls = []
  const state = { statistics: { cleanItemsRemoved: 5, reportedFreedBytes: 10, cleanOperationCount: 2 },
    addHistory: (record) => records.push(record), updateStatistics: (next) => Object.assign(state.statistics, next) }
  const store = Object.assign((selector) => selector(state), { getState: () => state })
  const deps = { '@/i18n': { useI18n: () => ({ t }) }, '@/stores/app': { useAppStore: store }, '@/lib/historyRecords': history }
  const uninstall = loadTypeScript('../src/pages/application-management/uninstallOutcome.ts', deps)
  const optimize = loadTypeScript('../src/pages/optimize/outcome.ts', deps)
  return { records, notices, calls, state, store, deps, uninstall, optimize }
}

test('Trash processing and unknown uninstall totals never become reported freed bytes', () => {
  const f = fixture()
  f.uninstall.recordUninstallExecution({ item_count: 1, total_size: 1000, dry_run: false, permanent: false }, app, t)
  assert.equal(f.records[0].cleanupSummary.sizeKind, 'processed')
  assert.equal(f.state.statistics.reportedFreedBytes, 10)
  f.uninstall.recordUninstallExecution({ item_count: null, total_size: null, dry_run: false, permanent: true }, app, t)
  assert.equal(f.records[1].cleanupSummary.itemCount, undefined)
  assert.equal(f.records[1].cleanupSummary.totalSize, undefined)
  assert.equal(f.records[1].cleanupSummary.outcome, 'unknown')
  assert.equal(f.records[1].executed, false)
  assert.equal(f.state.statistics.cleanOperationCount, 3)
  assert.equal(f.state.statistics.reportedFreedBytes, 10)
  assert.equal(f.state.statistics.cleanItemsRemoved, 6)
})

test('explicit uninstall zero is preserved and permanent deletion sizes remain processed bytes', () => {
  const f = fixture()
  f.uninstall.recordUninstallExecution({ item_count: 0, total_size: 0, dry_run: false, permanent: true }, app, t)
  assert.equal(f.records[0].cleanupSummary.itemCount, 0)
  assert.equal(f.records[0].cleanupSummary.totalSize, 0)
  assert.equal(f.records[0].cleanupSummary.outcome, 'skipped')
  assert.equal(f.records[0].executed, false)
  assert.equal(f.state.statistics.cleanOperationCount, 2)
  f.uninstall.recordUninstallExecution({ item_count: 1, total_size: 42, dry_run: false, permanent: true }, app, t)
  assert.equal(f.state.statistics.reportedFreedBytes, 10)
  assert.equal(f.records[1].cleanupSummary.sizeKind, 'processed')
  assert.equal(f.records[1].cleanupSummary.totalSize, 42)
  assert.equal(f.state.statistics.cleanItemsRemoved, 6)
  assert.equal(f.state.statistics.cleanOperationCount, 3)
  f.uninstall.recordUninstallExecution({ item_count: 9, total_size: 1000, dry_run: true, permanent: true }, app, t)
  assert.equal(f.records.length, 2, 'Preview output cannot be recorded as execution')
})

test('uninstall authorization requires a single app preview for the same deletion mode', () => {
  const f = fixture()
  const valid = { item_count: 1, total_size: null, dry_run: true, permanent: false }
  assert.equal(f.uninstall.canExecuteUninstall(valid, false), true)
  for (const changed of [{ item_count: 0 }, { item_count: null }, { item_count: 2 }, { dry_run: false }, { permanent: true }]) {
    assert.equal(f.uninstall.canExecuteUninstall({ ...valid, ...changed }, false), false)
  }
})

test('optimization reports zero or unknown without substituting the preview action count', () => {
  const f = fixture()
  f.optimize.recordOptimizeExecution({ applied_count: 0, summary_status: 'complete' }, t)
  f.optimize.recordOptimizeExecution({ applied_count: null, summary_status: 'unavailable' }, t)
  assert.equal(f.records[0].cleanupSummary.itemCount, 0)
  assert.equal(f.records[0].cleanupSummary.outcome, 'skipped')
  assert.equal(f.records[0].executed, false)
  assert.equal(f.records[1].cleanupSummary.itemCount, undefined)
  assert.equal(f.records[1].cleanupSummary.totalSize, undefined)
  assert.equal(f.records[1].cleanupSummary.outcome, 'unknown')
  assert.equal(f.records[1].executed, false)
  assert.equal(f.state.statistics.cleanOperationCount, 2)
  assert.equal(f.state.statistics.reportedFreedBytes, 10)
  assert.equal(f.optimize.canExecuteOptimize(health), true)
  for (const changed of [{ preview_status: 'incomplete' }, { preview_status: undefined }, { planned_count: null }, { planned_count: 0 }]) {
    assert.equal(f.optimize.canExecuteOptimize({ ...health, ...changed }), false)
  }
})

test('confirmed partial maintenance is recorded as partial rather than green success', () => {
  const f = fixture()
  f.uninstall.recordUninstallExecution({ item_count: 1, total_size: null, dry_run: false, permanent: true }, app, t)
  f.optimize.recordOptimizeExecution({ applied_count: 3, summary_status: 'partial' }, t)
  for (const record of f.records) {
    assert.equal(record.cleanupSummary.outcome, 'partial')
    assert.equal(record.executed, true)
    assert.ok(record.cleanupSummary.errors.length)
  }
  assert.equal(f.state.statistics.cleanOperationCount, 4)
  assert.equal(f.state.statistics.reportedFreedBytes, 10)
  f.optimize.recordOptimizeExecution({ applied_count: 0, summary_status: 'partial' }, t)
  assert.equal(f.records[2].cleanupSummary.outcome, 'failed')
  assert.equal(f.records[2].executed, false)
  assert.equal(f.state.statistics.cleanOperationCount, 4)
})

function createPage(kind, options = {}) {
  const f = fixture()
  const slots = []
  const pendingEffects = []
  let index = 0
  let strictMounted = false
  const location = { pathname: kind === 'apps' ? '/apps' : '/optimize' }
  const react = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], (next) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next }] },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial } },
    useMemo(compute, deps) { const slot = index++; if (!slots[slot] || deps.some((value, i) => value !== slots[slot].deps[i])) slots[slot] = { deps, value: compute() }; return slots[slot].value },
    useCallback(callback, deps) { const slot = index++; if (!slots[slot] || deps.some((value, i) => value !== slots[slot].deps[i])) slots[slot] = { deps, value: callback }; return slots[slot].value },
    useEffect(effect, deps) { const slot = index++; const old = slots[slot]; if (!old || deps.some((value, i) => value !== old.deps[i])) pendingEffects.push(() => { old?.cleanup?.(); slots[slot] = { deps, cleanup: effect() } }) },
  }
  const invoke = async (command, args) => {
    f.calls.push({ command, args })
    if (options.invoke) return options.invoke(command, args)
    if (command === 'mole_uninstall_list_json') return { items: [app, { ...app, name: 'Second', uninstall_name: 'Second', path: '/Applications/Second.app' }], total_size: 2 * 1024 ** 3 }
    if (command === 'maintenance_cancel') return
    if (command === 'mole_app_update_capability_json') return {}
    if (command === 'mole_uninstall_preview') return { item_count: 1, total_size: 0, raw_output: '', dry_run: true, permanent: args.permanent }
    assert.fail(`Unexpected native operation: ${command}`)
  }
  const cache = { resultCacheKeys: {}, loadResultSnapshot: async () => options.cache ?? null, saveResultSnapshot: async () => {} }
  const common = {
    ...f.deps, react, 'react-router-dom': { useLocation: () => location }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/ui/button': { Button: 'Button' }, '@/components/ui/input': { Input: 'Input' },
    '@/components/ui/badge': { Badge: 'Badge' }, '@/components/ui/progress': { Progress: 'Progress' },
    '@/components/ui/switch': { Switch: 'Switch' }, '@/lib/resultCache': cache,
    '@/lib/utils': { cn: (...parts) => parts.join(' '), formatFileSize: String, formatDecimal: String },
    '@tauri-apps/api/tauri': { invoke }, '@tauri-apps/api/shell': { open() {} },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    'react-toastify': { toast: Object.fromEntries(['success', 'warning', 'error', 'info'].map((name) => [name, (message) => f.notices.push({ name, message })])) },
  }
  common['@/lib/maintenanceRun'] = loadTypeScript('../src/lib/maintenanceRun.ts', {})
  common['@/hooks/useMaintenanceRun'] = loadTypeScript('../src/hooks/useMaintenanceRun.ts', common)
  common['@/components/MaintenanceRunStatus'] = { MaintenanceRunStatus: 'MaintenanceRunStatus' }
  const deps = kind === 'apps' ? {
    ...common, './application-management/uninstallOutcome': f.uninstall,
    './application-management/ApplicationControls': { MetricCard: 'MetricCard', ModeButton: 'ModeButton', SortButton: 'SortButton' },
    './application-management/ApplicationList': { ApplicationList: 'ApplicationList' },
    './application-management/appMatching': loadTypeScript('../src/pages/application-management/appMatching.ts', {}),
    '@/lib/stowmind-supplements/appUpdates': { scanStowmindSupplementAppUpdates() {}, runStowmindSupplementAppUpdateAction() {} },
  } : { ...common, './optimize/outcome': f.optimize }
  const name = kind === 'apps' ? 'ApplicationManagementPage' : 'OptimizePage'
  const Page = loadTypeScript(`../src/pages/${name}.tsx`, deps, { window: { confirm: () => true } })[name]
  return { ...f, location, render() {
    index = 0
    const tree = Page(), effects = pendingEffects.splice(0)
    effects.forEach((effect) => effect())
    if (options.strictMode && !strictMounted) {
      strictMounted = true
      slots.forEach((slot) => slot?.cleanup?.())
      effects.forEach((effect) => effect())
    }
    return tree
  } }
}
const button = (tree, key) => findElements(tree, (node) => ['Button', 'button'].includes(node.type) && renderedText(node).trim() === key)[0]

test('late uninstall preview for app A cannot authorize app B', async () => {
  let finish
  const f = createPage('apps', { invoke: async (command, args) => {
    if (command === 'mole_uninstall_list_json') return { items: [app, { ...app, name: 'B', uninstall_name: 'B', path: '/Applications/B.app' }], total_size: 0 }
    if (command === 'mole_app_update_capability_json') return {}
    if (command === 'mole_uninstall_preview') return new Promise((resolve) => { finish = resolve })
    assert.fail(`Execution must remain blocked: ${command}`)
  } })
  f.render(); await settle()
  let list = findElement(f.render(), 'ApplicationList')
  list.props.onSelect(list.props.rows[0])
  button(f.render(), 'apps.previewUninstall').props.onClick()
  list = findElement(f.render(), 'ApplicationList')
  list.props.onSelect(list.props.rows[1])
  finish({ item_count: 1, total_size: 100, dry_run: true, permanent: false, raw_output: '' })
  await settle()
  assert.equal(button(f.render(), 'apps.uninstallWithMole').props.disabled, true)
  assert.equal(f.calls.some(({ command }) => command === 'mole_uninstall_execute'), false)
})

test('changing permanent mode invalidates the preview and explicit zero preview size stays zero', async () => {
  const f = createPage('apps')
  f.render(); await settle()
  const list = findElement(f.render(), 'ApplicationList')
  list.props.onSelect(list.props.rows[0])
  button(f.render(), 'apps.previewUninstall').props.onClick(); await settle()
  let tree = f.render()
  assert.ok(renderedText(tree).includes('"size":"0"'), 'Zero must not fall back to the 1GB app size')
  assert.equal(button(tree, 'apps.uninstallWithMole').props.disabled, false)
  button(tree, 'apps.uninstallWithMole').props.onClick()
  tree = f.render()
  findElements(tree, (node) => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } })
  assert.equal(button(f.render(), 'apps.confirmRun').props.disabled, true)
  button(f.render(), 'apps.confirmRun').props.onClick(); await settle()
  assert.equal(f.calls.some(({ command }) => command === 'mole_uninstall_execute'), false)
})

test('an optimize refresh failure cannot leave a cached plan executable', async () => {
  const f = createPage('optimize', { cache: { payload: health }, invoke: async () => { throw new Error('preview failed') } })
  f.render(); await settle()
  const actions = findElements(f.render(), (node) => node.type === 'button' && renderedText(node).trim() === 'optimize.execute')
  assert.equal(actions.length, 2)
  assert.ok(actions.every((node) => node.props.disabled))
  actions[0].props.onClick(); await settle()
  assert.equal(f.calls.some(({ command }) => command === 'mole_optimize_execute'), false)
  assert.equal(f.records.length, 0)
})

test('optimize execution preserves a reported zero even with a nonempty filtered preview', async () => {
  const f = createPage('optimize', { invoke: async (command) => {
    if (command === 'mole_optimize_health_json') return health
    if (command === 'mole_optimize_execute') return { applied_count: 0, summary_status: 'complete', raw_output: 'Applied 0 optimizations' }
    assert.fail(`Unexpected command: ${command}`)
  } })
  f.render(); await settle()
  findElement(f.render(), 'Switch').props.onCheckedChange(true)
  const action = button(f.render(), 'optimize.execute')
  assert.equal(action.props.disabled, false, 'The display filter does not choose a smaller execution scope')
  action.props.onClick(); await settle()
  assert.equal(f.records.length, 1)
  assert.equal(f.records[0].cleanupSummary.itemCount, 0)
  assert.equal(f.records[0].cleanupSummary.outcome, 'skipped')
  assert.equal(f.records[0].executed, false)
  assert.equal(f.state.statistics.cleanOperationCount, 2)
  assert.match(f.calls.find(({ command }) => command === 'mole_optimize_execute').args.runId, /^maintenance-/)
  assert.ok(f.notices.some(({ name, message }) => name === 'success' && message.includes('"count":0')))
})

for (const [applied_count, summary_status, outcome, executed] of [
  [null, 'unavailable', 'unknown', false],
  [2, 'partial', 'partial', true],
]) {
  test(`the Optimize page records ${outcome} history from the actual native result`, async () => {
    const f = createPage('optimize', { invoke: async (command) => {
      if (command === 'mole_optimize_health_json') return health
      if (command === 'mole_optimize_execute') return { applied_count, summary_status, raw_output: 'Native result' }
      assert.fail(`Unexpected command: ${command}`)
    } })
    f.render(); await settle()
    button(f.render(), 'optimize.execute').props.onClick(); await settle()
    assert.equal(f.records.length, 1)
    assert.equal(f.records[0].cleanupSummary.outcome, outcome)
    assert.equal(f.records[0].executed, executed)
    assert.equal(f.state.statistics.cleanOperationCount, executed ? 3 : 2)
    assert.equal(f.notices.some(({ name }) => name === 'success'), false)
  })
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

for (const kind of ['apps', 'optimize']) {
  test(`${kind} exposes cancellation during scanning and remains busy until both native responses settle`, async () => {
    const scan = deferred(), stop = deferred()
    const f = createPage(kind, { invoke: (command) => {
      if (command === 'mole_app_update_capability_json') return {}
      if (command === 'maintenance_cancel') return stop.promise
      return scan.promise
    } })
    f.render(); await settle()
    const status = findElement(f.render(), 'MaintenanceRunStatus')
    assert.equal(status.props.state.busy, true)
    status.props.onCancel(); await settle()
    assert.equal(findElement(f.render(), 'MaintenanceRunStatus').props.state.cancelling, true)
    stop.resolve(); await settle()
    assert.equal(findElement(f.render(), 'MaintenanceRunStatus').props.state.busy, true)
    scan.reject({ code: 'cancelled', message: 'Stopped', raw_output: 'Partial scan log', output_truncated: false })
    await settle()
    const state = findElement(f.render(), 'MaintenanceRunStatus').props.state
    assert.equal(state.busy, false)
    assert.equal(state.output, 'Partial scan log')
    assert.equal(state.failure.code, 'cancelled')
    assert.equal(f.records.length, 0)
    assert.equal(f.state.statistics.cleanOperationCount, 2)
    assert.equal(f.notices.some(({ name }) => name === 'success'), false)
  })
}

for (const [code, partial] of [['cancelled', true], ['timeout', true], ['cancelled', false]]) {
  test(`uninstall ${code} retains only actual execution evidence (partial result: ${partial})`, async () => {
    const f = createPage('apps', { invoke: async (command, args) => {
      if (command === 'mole_app_update_capability_json') return {}
      if (command === 'mole_uninstall_list_json') return { items: [app], total_size: app.size_bytes }
      if (command === 'mole_uninstall_preview') return { item_count: 1, total_size: 9999, raw_output: 'Would remove 1 app', dry_run: true, permanent: args.permanent }
      if (command === 'mole_uninstall_execute') throw { code, message: 'Interrupted', raw_output: 'Removed 1 app', output_truncated: false,
        ...(partial ? { partial_result: { item_count: 1, total_size: null, raw_output: 'Removed 1 app', dry_run: false, permanent: false } } : {}) }
      assert.fail(command)
    } })
    f.render(); await settle()
    const list = findElement(f.render(), 'ApplicationList')
    list.props.onSelect(list.props.rows[0])
    button(f.render(), 'apps.previewUninstall').props.onClick(); await settle()
    button(f.render(), 'apps.uninstallWithMole').props.onClick()
    button(f.render(), 'apps.confirmRun').props.onClick(); await settle()
    const tree = f.render(), state = findElement(tree, 'MaintenanceRunStatus').props.state
    assert.equal(state.failure.code, code)
    assert.equal(state.output, 'Removed 1 app')
    assert.equal(button(tree, 'apps.confirmRun').props.disabled, true, 'Interrupted execution invalidates the review')
    assert.equal(f.records.length, partial ? 1 : 0)
    if (partial) {
      assert.equal(f.records[0].cleanupSummary.outcome, 'partial')
      assert.equal(f.records[0].cleanupSummary.itemCount, 1)
      assert.equal(f.records[0].cleanupSummary.totalSize, undefined)
      assert.equal(f.records[0].executed, true)
    }
    assert.equal(f.state.statistics.cleanOperationCount, partial ? 3 : 2)
    assert.equal(f.state.statistics.reportedFreedBytes, 10)
    assert.equal(f.notices.some(({ message }) => message.startsWith('apps.uninstallSuccess')), false)
  })
}

for (const count of [null, 2]) {
  test(`optimize timeout records actual count ${count} and cannot reuse the preview`, async () => {
    const f = createPage('optimize', { invoke: async (command) => {
      if (command === 'mole_optimize_health_json') return health
      if (command === 'mole_optimize_execute') throw { code: 'timeout', message: 'Timed out', raw_output: 'Actual execution output', output_truncated: true,
        partial_result: { applied_count: count, summary_status: 'unavailable', raw_output: 'Actual execution output' } }
      assert.fail(command)
    } })
    f.render(); await settle()
    button(f.render(), 'optimize.execute').props.onClick(); await settle()
    const tree = f.render()
    assert.equal(button(tree, 'optimize.execute').props.disabled, true)
    assert.equal(findElement(tree, 'MaintenanceRunStatus').props.state.failure.output_truncated, true)
    assert.equal(f.records[0].cleanupSummary.itemCount, count ?? undefined)
    assert.equal(f.records[0].cleanupSummary.outcome, count ? 'partial' : 'unknown')
    assert.equal(f.state.statistics.cleanOperationCount, count ? 3 : 2)
    assert.equal(f.notices.some(({ name }) => name === 'success'), false)
    assert.equal(f.calls.filter(({ command }) => command === 'mole_optimize_health_json').length, 1, 'Interrupted work must not silently replace the diagnostic log with a new scan')
  })
}

for (const kind of ['apps', 'optimize']) {
  test(`${kind} StrictMode effect replay does not leave its initial scan cancelled`, async () => {
    const f = createPage(kind, { strictMode: true, invoke: async (command) => {
      if (command === 'mole_app_update_capability_json') return {}
      if (command === 'mole_uninstall_list_json') return { items: [app], total_size: app.size_bytes }
      if (command === 'mole_optimize_health_json') return health
      assert.fail(`Unexpected operation during initial mount: ${command}`)
    } })
    f.render(); await settle()
    assert.equal(findElement(f.render(), 'MaintenanceRunStatus').props.state.busy, false)
    const command = kind === 'apps' ? 'mole_uninstall_list_json' : 'mole_optimize_health_json'
    assert.equal(f.calls.filter((entry) => entry.command === command).length, 1)
    if (kind === 'optimize') assert.equal(button(f.render(), 'optimize.execute').props.disabled, false)
    else assert.equal(findElement(f.render(), 'ApplicationList').props.rows.length, 1)
  })
}

test('a normally returned uninstall result with unknown bytes warns instead of reporting success', async () => {
  const f = createPage('apps', { invoke: async (command, args) => {
    if (command === 'mole_app_update_capability_json') return {}
    if (command === 'mole_uninstall_list_json') return { items: [app], total_size: app.size_bytes }
    if (command === 'mole_uninstall_preview') return { item_count: 1, total_size: 9999, raw_output: '', dry_run: true, permanent: args.permanent }
    if (command === 'mole_uninstall_execute') return { item_count: 1, total_size: null, raw_output: 'Removed 1 app', dry_run: false, permanent: false }
    assert.fail(command)
  } })
  f.render(); await settle()
  const list = findElement(f.render(), 'ApplicationList')
  list.props.onSelect(list.props.rows[0])
  button(f.render(), 'apps.previewUninstall').props.onClick(); await settle()
  button(f.render(), 'apps.uninstallWithMole').props.onClick()
  button(f.render(), 'apps.confirmRun').props.onClick(); await settle()
  assert.equal(f.records[0].cleanupSummary.outcome, 'partial')
  assert.equal(f.notices.some(({ message }) => message.startsWith('apps.uninstallSuccess')), false)
  assert.ok(f.notices.some(({ name, message }) => name === 'warning' && message === 'apps.summaryUnknown'))
})
