import assert from 'node:assert/strict'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const { zh } = loadTypeScript('../src/i18n/zh.ts', {})
const t = (key, parameters = {}) => {
  assert.ok(key in zh, `Missing Chinese translation: ${key}`)
  return zh[key].replace(/\{(\w+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`))
}
const helpers = loadTypeScript('../src/pages/system-cache/helpers.ts', {})
const historyRecords = loadTypeScript('../src/lib/historyRecords.ts', {})
const agentSizes = loadTypeScript('../src/pages/agent-cleanup/sizeSummary.ts', {
  '@/lib/utils': { formatFileSize: (value) => `${value} bytes` },
})
const executionSize = loadTypeScript('../src/pages/agent-cleanup/executionSize.ts', {
  '@/lib/utils': { formatFileSize: (value) => `${value} bytes` },
})
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
        removed_count: args.request.itemIds.length, processed_bytes: 384, freed_bytes: null, skipped_count: 0, errors: [],
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
    './system-cache/helpers': helpers,
    './system-cache/helpers.ts': helpers,
    './system-cache/useSystemCache': { useSystemCache },
    './agent-cleanup/sizeSummary': agentSizes,
    './agent-cleanup/executionSize': executionSize,
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

export { createPage, t, button, settle, agentPreview, cacheReport, authorizedReport, cacheOutcome }
