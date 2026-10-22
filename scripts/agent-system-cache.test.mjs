import assert from 'node:assert/strict'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const { zh } = loadTypeScript('../src/i18n/zh.ts', {})
const t = (key, parameters = {}) => {
  assert.ok(key in zh, `Missing Chinese translation: ${key}`)
  return zh[key].replace(/\{(\w+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`))
}
const helpers = loadTypeScript('../src/pages/system-cache/helpers.ts', {})
const historyRecords = loadTypeScript('../src/lib/historyRecords.ts', {})
const cacheReport = {
  source: 'stowmind_supplement', target_id: 'iconservices',
  path: '/Library/Caches/com.apple.iconservices.store', scanned_at: 1700000000,
  status: 'complete', size_bytes: 270 * 1024 ** 3, modified_at: 1700000000,
  authorized: false, anomaly: true, threshold_bytes: 10 * 1024 ** 3,
  message: 'Measured shared cache', mole_supported: true, mole_message: '', review_token: null,
}
const authorizedReport = { ...cacheReport, authorized: true, review_token: 'one-time-token' }
const cacheOutcome = {
  source: 'mole', before: authorizedReport,
  after: { ...cacheReport, size_bytes: 1024 ** 3, anomaly: false, authorized: true },
  success: true, attempted: true, errors: [], measured_delta_bytes: 269 * 1024 ** 3,
  completed_at: 1700000010,
}
const agentPreview = {
  scanned_at: 1700000000, retention_days: 30,
  agents: [{ id: 'codex', name: 'Codex', available: true }], protected: [],
  items: [
    { id: 'cache-a', agent: 'codex', category: 'cache', path: '/tmp/agent-a', size: 128, default_selected: true, protected: false },
    { id: 'cache-b', agent: 'codex', category: 'cache', path: '/tmp/agent-b', size: 256, default_selected: false, protected: false },
    { id: 'git-prune', agent: 'codex', category: 'git_unreachable_object', path: '/tmp/repo/.git/objects', size: 512, default_selected: false, protected: false },
    { id: 'protected', agent: 'codex', category: 'cache', path: '/tmp/active-agent', size: 1024, default_selected: false, protected: true },
  ],
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const button = (tree, text) => findElements(tree, (element) => element.type === 'Button' && renderedText(element).trim() === text)[0]

function createPage(invokeOverride) {
  const states = []
  const pendingEffects = []
  const calls = []
  const listeners = new Map()
  const history = []
  const notices = []
  const confirmations = []
  let cursor = 0
  let uniqueId = 0
  let pathname = '/agent-cleanup'
  const store = {
    statistics: { totalFilesOrganized: 0, totalSizeOrganized: 0, categoryCounts: {} },
    addHistory: (record) => history.push(record),
    updateStatistics: (values) => { store.statistics = { ...store.statistics, ...values } },
  }
  const useAppStore = Object.assign((selector) => selector(store), { getState: () => store })
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
        pendingEffects.push(() => {
          previous?.cleanup?.()
          states[index] = { dependencies, cleanup: effect(), effect }
        })
      }
    },
    useId: () => `shared-cache-title-${++uniqueId}`,
  }
  const toast = Object.fromEntries(['success', 'error', 'info'].map((kind) => [kind, (message) => notices.push({ kind, message })]))
  const common = {
    'react/jsx-runtime': { jsx, jsxs: jsx }, react,
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/i18n': { useI18n: () => ({ t }) },
    '@/lib/utils': { cn: (...values) => values.join(' '), formatDate: String, formatFileSize: (value) => `${value} bytes` },
    '@/components/ui/button': { Button: 'Button' },
  }
  const ipc = async (command, args) => {
    calls.push({ command, args })
    const fallback = () => {
      if (command === 'agent_cleanup_scan') return agentPreview
      if (command === 'system_cache_scan') return cacheReport
      if (command === 'system_cache_review') return authorizedReport
      if (command === 'system_cache_clean') return cacheOutcome
      if (command === 'mole_clean_preview_pty_cancel') return null
      if (command === 'agent_cleanup_execute') return {
        removed_count: args.request.itemIds.length, freed_bytes: 384, skipped_count: 0, errors: [],
        completed_at: '1700000010',
        actions: agentPreview.items.filter((item) => args.request.itemIds.includes(item.id)).map((item) => ({ path: item.path, success: true })),
      }
      assert.fail(`Unexpected command: ${command}`)
    }
    return invokeOverride ? invokeOverride(command, args, fallback) : fallback()
  }
  const systemHistory = loadTypeScript('../src/lib/stowmind-supplements/systemCacheHistory.ts', {
    '@/stores/app': { useAppStore },
  })
  const { useSystemCache } = loadTypeScript('../src/pages/system-cache/useSystemCache.ts', {
    react,
    '@/i18n': common['@/i18n'],
    '@/lib/stowmind-supplements/systemCacheHistory': systemHistory,
    '@tauri-apps/api/tauri': { invoke: ipc },
    '@tauri-apps/api/event': { listen: async (event, callback) => {
      listeners.set(event, callback)
      return () => listeners.delete(event)
    } },
    'react-toastify': { toast }, './helpers': helpers,
  }, {
    crypto: { randomUUID: () => `agent-shared-run-${++uniqueId}` },
    window: { confirm: (message) => { confirmations.push(message); return true } },
  })
  const { SystemCacheCard } = loadTypeScript('../src/pages/system-cache/SystemCacheCard.tsx', {
    ...common, './helpers': helpers,
    '../clean/CleanInteractionPrompt': { CleanInteractionPrompt: 'Prompt' },
  })
  const { AgentCleanupPage } = loadTypeScript('../src/pages/AgentCleanupPage.tsx', {
    ...common,
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((name) => [name, name])),
    '@/lib/historyRecords': historyRecords,
    '@/stores/app': { useAppStore },
    '@tauri-apps/api/tauri': { invoke: ipc },
    'react-router-dom': { useLocation: () => ({ pathname }) },
    'react-toastify': { toast },
    './system-cache/SystemCacheCard': { SystemCacheCard },
    './system-cache/useSystemCache': { useSystemCache },
  }, {
    window: { confirm: (message) => { confirmations.push(message); return true } },
  })
  return {
    calls, history, notices, confirmations, store, listeners,
    render() {
      cursor = 0
      const tree = AgentCleanupPage()
      pendingEffects.splice(0).forEach((effect) => effect())
      return tree
    },
    replayEffects() {
      const effects = states.filter((state) => state?.effect)
      effects.forEach((state) => state.cleanup?.())
      effects.forEach((state) => { state.cleanup = state.effect() })
    },
    shared(tree) {
      const node = findElements(tree, (element) => element.type === SystemCacheCard)[0]
      assert.ok(node, 'The shared cache card must be present independently of Agent results')
      return { props: node.props, tree: SystemCacheCard(node.props) }
    },
    setPath(path) { pathname = path },
  }
}

test('entry starts one Agent scan and one independent system scan without administrator actions', async () => {
  let finishAgent
  let finishCache
  const page = createPage((command, _args, fallback) => {
    if (command === 'agent_cleanup_scan') return new Promise((resolve) => { finishAgent = resolve })
    if (command === 'system_cache_scan') return new Promise((resolve) => { finishCache = resolve })
    return fallback()
  })
  page.render()
  assert.equal(page.calls.filter(({ command }) => command === 'agent_cleanup_scan').length, 1)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 1)
  finishAgent(agentPreview)
  await settle()
  const tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 1, size: '128 bytes' })))
  assert.equal(button(tree, t('agentCleanup.rescan')).props.disabled, false, 'Agent results must not wait for the system probe')
  assert.equal(page.shared(tree).props.cache.activity, 'scan')
  finishCache(cacheReport)
  await settle()
  assert.equal(page.calls.some(({ command }) => command.includes('review') || command.includes('clean_execute') || command === 'system_cache_clean'), false)
})

test('StrictMode effect replay keeps both pending initial scans single and accepts their results', async () => {
  let finishAgent
  let finishCache
  const page = createPage((command, _args, fallback) => {
    if (command === 'agent_cleanup_scan') return new Promise((resolve) => { finishAgent = resolve })
    if (command === 'system_cache_scan') return new Promise((resolve) => { finishCache = resolve })
    return fallback()
  })
  page.render()
  page.replayEffects()
  assert.equal(page.calls.filter(({ command }) => command === 'agent_cleanup_scan').length, 1)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 1)
  assert.equal(page.calls.some(({ command }) => command === 'mole_clean_preview_pty_cancel'), false)
  finishCache(cacheReport)
  await settle()
  let tree = page.render()
  assert.equal(page.shared(tree).props.cache.report.size_bytes, cacheReport.size_bytes)
  assert.equal(page.shared(tree).props.cache.activity, null)
  finishAgent(agentPreview)
  await settle()
  tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 1, size: '128 bytes' })))
  assert.equal(button(tree, t('agentCleanup.rescan')).props.disabled, false)
  assert.equal(page.calls.filter(({ command }) => command === 'agent_cleanup_scan').length, 1)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 1)
})

test('manual rescan starts both probes and preserves their separate result handling', async () => {
  const page = createPage()
  page.render()
  await settle()
  button(page.render(), t('agentCleanup.rescan')).props.onClick()
  await settle()
  assert.equal(page.calls.filter(({ command }) => command === 'agent_cleanup_scan').length, 2)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 2)
})

test('Agent retention changes are not forwarded to the fixed shared cache probe', async () => {
  const page = createPage()
  page.render()
  await settle()
  const retention = findElements(page.render(), (element) => element.type === 'input' && element.props.type === 'number')[0]
  retention.props.onChange({ target: { value: '7' } })
  button(page.render(), t('agentCleanup.rescan')).props.onClick()
  await settle()
  const agentScans = page.calls.filter(({ command }) => command === 'agent_cleanup_scan')
  const systemScans = page.calls.filter(({ command }) => command === 'system_cache_scan')
  assert.equal(agentScans[1].args.retentionDays, 7)
  assert.equal(systemScans[1].args, undefined)
  assert.equal(page.shared(page.render()).props.cache.report.threshold_bytes, cacheReport.threshold_bytes)
})

test('Agent scan failure does not discard the shared system cache result', async () => {
  const page = createPage((command, _args, fallback) => {
    if (command === 'agent_cleanup_scan') throw new Error('Agent scan failed')
    return fallback()
  })
  page.render()
  await settle()
  const tree = page.render()
  assert.ok(renderedText(tree).includes('Agent scan failed'))
  const shared = page.shared(tree)
  assert.equal(shared.props.cache.report.size_bytes, cacheReport.size_bytes)
  assert.ok(renderedText(shared.tree).includes(t('systemCache.sharedTitle')))
})

test('system scan failure leaves successful Agent results and selection usable', async () => {
  const page = createPage((command, _args, fallback) => {
    if (command === 'system_cache_scan') throw new Error('Shared cache scan failed')
    return fallback()
  })
  page.render()
  await settle()
  const tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 1, size: '128 bytes' })))
  assert.equal(button(tree, t('agentCleanup.cleanSelected')).props.disabled, false)
  assert.equal(page.shared(tree).props.cache.error, 'Error: Shared cache scan failed')
  assert.equal(page.notices.some(({ kind }) => kind === 'error'), false, 'A system probe error must not become an Agent scan failure toast')
})

test('shared permission denial stays unknown with a separate scope explanation and no selectable checkbox', async () => {
  const page = createPage((command, _args, fallback) => command === 'system_cache_scan'
    ? { ...cacheReport, status: 'permission_denied', size_bytes: null, anomaly: null }
    : fallback())
  page.render()
  await settle()
  const shared = page.shared(page.render())
  const text = renderedText(shared.tree)
  for (const key of ['systemCache.sharedTitle', 'systemCache.sharedDescription', 'systemCache.sharedScopeHint', 'systemCache.unknownSize']) assert.ok(text.includes(t(key)))
  assert.equal(findElements(shared.tree, (element) => element.props?.type === 'checkbox').length, 0)
  assert.equal(button(shared.tree, t('systemCache.clean')).props.disabled, true)
})

test('bulk Agent selection, bytes, execution and history exclude the shared icon cache', async () => {
  const page = createPage()
  page.render()
  await settle()
  let tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 1, size: '128 bytes' })))
  button(tree, t('agentCleanup.toggleAll')).props.onClick()
  tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 2, size: '384 bytes' })))
  assert.equal(page.shared(tree).props.cache.report.size_bytes, 270 * 1024 ** 3)
  button(tree, t('agentCleanup.cleanSelected')).props.onClick()
  await settle()
  const execution = page.calls.find(({ command }) => command === 'agent_cleanup_execute')
  assert.deepEqual([...execution.args.request.itemIds], ['cache-a', 'cache-b'])
  assert.equal(execution.args.request.retentionDays, 30)
  assert.equal(execution.args.request.confirmed, true)
  assert.equal(page.calls.some(({ command }) => command === 'system_cache_clean' || command === 'system_cache_review'), false)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 2, 'Agent execution refreshes the separate read-only cache probe')
  assert.equal(page.history.length, 1)
  assert.equal(page.history[0].type, 'agent-cleanup')
  assert.equal(page.history[0].cleanupSummary.totalSize, 384)
  assert.equal(page.store.statistics.agentCleanupSizeFreed, 384)
  assert.equal(page.store.statistics.systemCacheCleanupCount, undefined)
})

test('independent administrator review and cleanup from Agent page keep system history and statistics separate', async () => {
  const page = createPage()
  page.render()
  await settle()
  button(page.shared(page.render()).tree, t('systemCache.review')).props.onClick()
  await settle()
  let tree = page.render()
  const shared = page.shared(tree)
  assert.equal(button(shared.tree, t('systemCache.clean')).props.disabled, false)
  button(shared.tree, t('systemCache.clean')).props.onClick()
  await settle()
  tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 1, size: '128 bytes' })))
  const execution = page.calls.find(({ command }) => command === 'system_cache_clean')
  assert.equal(execution.args.reviewToken, 'one-time-token')
  assert.equal(execution.args.confirmed, true)
  assert.equal(page.calls.some(({ command }) => command === 'agent_cleanup_execute'), false)
  assert.equal(page.history.length, 1)
  assert.equal(page.history[0].type, 'system-cache')
  assert.equal(page.store.statistics.systemCacheCleanupCount, 1)
  assert.equal(page.store.statistics.agentCleanupSizeFreed, undefined)
})

test('returning to the Agent page refreshes shared authorization without resetting Agent manual selections', async () => {
  const page = createPage()
  page.render()
  await settle()
  button(page.render(), t('agentCleanup.toggleAll')).props.onClick()
  button(page.shared(page.render()).tree, t('systemCache.review')).props.onClick()
  await settle()
  assert.equal(page.shared(page.render()).props.cache.report.review_token, 'one-time-token')
  page.setPath('/doctor')
  assert.equal(page.shared(page.render()).props.active, false)
  page.setPath('/agent-cleanup')
  page.render()
  await settle()
  const tree = page.render()
  assert.equal(page.calls.filter(({ command }) => command === 'agent_cleanup_scan').length, 1)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 2)
  assert.equal(page.shared(tree).props.cache.report.review_token, null)
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 2, size: '384 bytes' })))
})

test('leaving the Agent page cancels its shared cleanup and preserves the failed system history', async () => {
  let finishCleanup
  const page = createPage((command, _args, fallback) => command === 'system_cache_clean'
    ? new Promise((resolve) => { finishCleanup = resolve })
    : fallback())
  page.render()
  await settle()
  button(page.shared(page.render()).tree, t('systemCache.review')).props.onClick()
  await settle()
  button(page.shared(page.render()).tree, t('systemCache.clean')).props.onClick()
  await settle()
  assert.equal(page.listeners.size, 2)
  page.setPath('/doctor')
  page.render()
  assert.equal(page.calls.filter(({ command }) => command === 'mole_clean_preview_pty_cancel').length, 1)
  assert.equal(page.listeners.size, 0)
  const prompt = findElements(page.shared(page.render()).tree, (element) => element.type === 'Prompt')[0]
  assert.equal(prompt.props.open, false)
  finishCleanup({ ...cacheOutcome, success: false, errors: ['Cancelled cleanup'] })
  await settle()
  assert.equal(page.history.length, 1)
  assert.equal(page.history[0].type, 'system-cache')
  assert.equal(page.history[0].cleanupSummary.outcome, 'failed')
  assert.equal(page.store.statistics.systemCacheCleanupCount, undefined)
})

test('separately mounted shared cards have unique accessible heading references', async () => {
  const page = createPage()
  page.render()
  await settle()
  const tree = page.render()
  const first = page.shared(tree).tree
  const second = page.shared(tree).tree
  assert.notEqual(first.props['aria-labelledby'], second.props['aria-labelledby'])
  assert.equal(findElements(first, (element) => element.type === 'h2')[0].props.id, first.props['aria-labelledby'])
})

test('Doctor wrapper continues to scan only for its own active route', () => {
  let pathname = '/doctor'
  let lastDependencies
  let scans = 0
  const cache = { scan: () => { scans += 1 } }
  const { SystemCachePanel } = loadTypeScript('../src/pages/system-cache/SystemCachePanel.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useEffect(effect, dependencies) {
      if (!lastDependencies || dependencies.some((value, index) => value !== lastDependencies[index])) effect()
      lastDependencies = dependencies
    } },
    'react-router-dom': { useLocation: () => ({ pathname }) },
    './useSystemCache': { useSystemCache: () => cache },
    './SystemCacheCard': { SystemCacheCard: 'SystemCacheCard' },
  })
  let card = SystemCachePanel()
  assert.equal(scans, 1)
  assert.equal(card.props.active, true)
  assert.equal(card.props.shared, undefined)
  pathname = '/agent-cleanup'
  card = SystemCachePanel()
  assert.equal(card.props.active, false)
  assert.equal(scans, 1)
  pathname = '/doctor'
  SystemCachePanel()
  assert.equal(scans, 2)
})
