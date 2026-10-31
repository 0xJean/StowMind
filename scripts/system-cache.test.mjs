import assert from 'node:assert/strict'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const { zh } = loadTypeScript('../src/i18n/zh.ts', {})
const t = (key, parameters = {}) => {
  assert.ok(key in zh, `Missing translation: ${key}`)
  return zh[key].replace(/\{(\w+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`))
}
const helpers = loadTypeScript('../src/pages/system-cache/helpers.ts', {})
const complete = {
  source: 'stowmind_supplement', target_id: 'iconservices',
  path: '/Library/Caches/com.apple.iconservices.store', scanned_at: 1700000000,
  status: 'complete', size_bytes: 30 * 1024 ** 3, modified_at: 1700000000,
  authorized: true, anomaly: true, threshold_bytes: 10 * 1024 ** 3,
  message: '', mole_supported: true, mole_message: '', review_token: 'review-token',
}
const outcome = {
  source: 'mole', before: complete,
  after: { ...complete, review_token: null, size_bytes: null, status: 'permission_denied' },
  success: false, attempted: true, errors: ['Mole protected the target'],
  measured_delta_bytes: null, completed_at: 1700000010,
}

function createHook(invoke, { confirm = true, listen } = {}) {
  const states = []
  const history = []
  const successes = []
  const calls = []
  const listeners = new Map()
  const stopped = []
  const updates = []
  const pendingEffects = []
  let cursor = 0
  let id = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => {
        updates.push(index)
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = { current: initial }
      return states[index]
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
  }
  const { useSystemCache } = loadTypeScript('../src/pages/system-cache/useSystemCache.ts', {
    react,
    '@/i18n': { useI18n: () => ({ t }) },
    '@/lib/stowmind-supplements/systemCacheHistory': { recordSystemCacheCleanup: (...args) => history.push(args) },
    '@tauri-apps/api/tauri': { invoke: async (command, args) => { calls.push({ command, args }); return invoke(command, args) } },
    '@tauri-apps/api/event': { listen: async (event, callback) => {
      const register = () => {
        listeners.set(event, callback)
        return () => { stopped.push(event); listeners.delete(event) }
      }
      return listen ? listen(event, callback, register) : register()
    } },
    'react-toastify': { toast: { success: (message) => successes.push(message) } },
    './helpers': helpers,
  }, {
    crypto: { randomUUID: () => `run-${++id}` },
    window: { confirm: () => confirm },
  })
  return {
    history, successes, calls, listeners, stopped, updates,
    render(active = true) {
      cursor = 0
      const hook = useSystemCache(active)
      pendingEffects.splice(0).forEach((effect) => effect())
      return hook
    },
    unmount() { states.filter((state) => state?.effect).forEach((state) => state.cleanup?.()) },
    replayEffects() {
      const effects = states.filter((state) => state?.effect)
      effects.forEach((state) => state.cleanup?.())
      effects.forEach((state) => { state.cleanup = state.effect() })
    },
  }
}

test('incomplete measurements and missing authorization never enable cleanup', () => {
  for (const report of [
    null, { ...complete, size_bytes: null }, { ...complete, status: 'partial' },
    { ...complete, status: 'permission_denied' }, { ...complete, authorized: false },
    { ...complete, review_token: null }, { ...complete, mole_supported: false },
    { ...complete, size_bytes: 0 },
  ]) assert.equal(helpers.canCleanSystemCache(report), false)
  assert.equal(helpers.canCleanSystemCache(complete), true)
  assert.equal(helpers.measurementDeltaLabel(-123, t, String), t('systemCache.increased', { size: '123' }))
})

test('unknown measurements render as unknown, without a zero-sized cleanup affordance', () => {
  const cache = {
    report: { ...complete, status: 'permission_denied', size_bytes: null, review_token: null },
    outcome: null, activity: null, interaction: null, input: '',
    scan() {}, review() {}, clean() {}, cancel() {}, submit() {}, setInput() {},
  }
  const { SystemCacheCard } = loadTypeScript('../src/pages/system-cache/SystemCacheCard.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useId: () => 'cache-title' },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/i18n': { useI18n: () => ({ t }) },
    '@/lib/utils': { cn: (...values) => values.join(' '), formatDate: String, formatFileSize: (n) => `${n} bytes` },
    '@/components/ui/button': { Button: 'Button' },
    '../clean/CleanInteractionPrompt': { CleanInteractionPrompt: 'Prompt' },
    './helpers': helpers,
  })
  const tree = SystemCacheCard({ cache, active: true })
  assert.ok(renderedText(tree).includes(t('systemCache.unknownSize')))
  const size = findElements(tree, (element) => element.props?.className === 'text-2xl font-bold tabular-nums')[0]
  assert.equal(renderedText(size), t('systemCache.unknownSize'))
  // Cleanup is no longer a separate card affordance; only the read-only
  // review action remains and stays disabled for an unsupported target.
  const clean = findElements(tree, (element) => element.type === 'Button' && renderedText(element).includes(t('systemCache.clean')))[0]
  assert.equal(clean, undefined)
  const review = findElements(tree, (element) => element.type === 'Button' && renderedText(element).includes(t('systemCache.review')))[0]
  assert.ok(review)
})

test('StrictMode setup-cleanup-setup preserves a pending read-only scan without duplicating it', async () => {
  let finishScan
  const hook = createHook((command) => {
    assert.equal(command, 'system_cache_scan')
    return new Promise((resolve) => { finishScan = resolve })
  })
  const scanning = hook.render().scan()
  hook.replayEffects()
  await hook.render().scan()
  assert.equal(hook.calls.length, 1)
  assert.equal(hook.listeners.size, 0)
  const report = { ...complete, authorized: false, review_token: null }
  finishScan(report)
  await scanning
  assert.deepEqual({ ...hook.render().report }, report)
  assert.equal(hook.render().activity, null)
  assert.equal(hook.history.length, 0)
})

test('a read-only rescan after review keeps the issued token so the cache stays queued', async () => {
  const hook = createHook(async (command) => {
    if (command === 'system_cache_review') return { ...complete, authorized: true, review_token: 'issued-token' }
    if (command === 'system_cache_scan') return { ...complete, authorized: true, review_token: null }
    assert.fail(`Unexpected command: ${command}`)
  })
  await hook.render().review()
  assert.equal(hook.render().report.review_token, 'issued-token')
  assert.equal(helpers.canCleanSystemCache(hook.render().report), true)
  await hook.render().scan()
  assert.equal(hook.render().report.review_token, 'issued-token', 'read-only scans must not drop the queued authorization')
  assert.equal(helpers.canCleanSystemCache(hook.render().report), true)
  assert.equal(hook.calls.filter(({ command }) => command === 'system_cache_review').length, 1)
})

for (const result of ['resolve', 'reject']) {
  test(`a read-only scan that ${result}s after real unmount cannot update React state`, async () => {
    let finishScan
    const hook = createHook((command) => {
      assert.equal(command, 'system_cache_scan')
      return new Promise((resolve, reject) => { finishScan = result === 'resolve' ? resolve : reject })
    })
    const scanning = hook.render().scan()
    hook.unmount()
    const updatesBeforeResolution = hook.updates.length
    finishScan(result === 'resolve' ? complete : new Error('Scan failed after unmount'))
    await scanning
    assert.equal(hook.updates.length, updatesBeforeResolution)
    assert.equal(hook.calls.length, 1, 'Read-only scans must not invoke PTY cancellation')
    assert.equal(hook.listeners.size, 0)
    assert.equal(hook.history.length, 0)
    assert.equal(hook.successes.length, 0)
  })
}

test('declining confirmation does not invoke Mole cleanup', async () => {
  const hook = createHook(async (command) => {
    assert.equal(command, 'system_cache_review')
    return complete
  }, { confirm: false })
  await hook.render().review()
  await hook.render().clean()
  assert.equal(hook.calls.length, 1)
  assert.equal(hook.history.length, 0)
})

test('Mole failure records before and after, without a success toast; failed refresh preserves the outcome', async () => {
  const hook = createHook(async (command) => {
    if (command === 'system_cache_review') return complete
    if (command === 'system_cache_clean') return outcome
    throw new Error('Scan unavailable')
  })
  await hook.render().review()
  await hook.render().clean()
  assert.equal(hook.history.length, 1)
  assert.equal(hook.history[0][0], outcome)
  assert.equal(hook.render().outcome, outcome)
  assert.equal(hook.render().error, 'Mole protected the target')
  assert.equal(hook.successes.length, 0)
  await hook.render().scan()
  assert.equal(hook.render().outcome, outcome)
  assert.equal(hook.history.length, 1)
  assert.equal(hook.render().error, 'Error: Scan unavailable')
})

test('duplicate review and clean clicks cannot launch concurrent operations', async () => {
  let resolveReview
  let resolveClean
  const hook = createHook((command) => {
    if (command === 'system_cache_review') return new Promise((resolve) => { resolveReview = resolve })
    if (command === 'system_cache_clean') return new Promise((resolve) => { resolveClean = resolve })
    assert.fail(`Unexpected command: ${command}`)
  })
  const first = hook.render().review()
  const second = hook.render().review()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(hook.calls.filter(({ command }) => command === 'system_cache_review').length, 1)
  resolveReview(complete)
  await Promise.all([first, second])
  const cleanFirst = hook.render().clean()
  const cleanSecond = hook.render().clean()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(hook.calls.filter(({ command }) => command === 'system_cache_clean').length, 1)
  resolveClean(outcome)
  await Promise.all([cleanFirst, cleanSecond])
  assert.equal(hook.history.length, 1)
})

test('effect replay still cancels an active PTY review and rejects its late authorization', async () => {
  let finishReview
  const hook = createHook((command) => {
    if (command === 'system_cache_review') return new Promise((resolve) => { finishReview = resolve })
    assert.equal(command, 'mole_clean_preview_pty_cancel')
  })
  const review = hook.render().review()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(hook.listeners.size, 2)
  hook.replayEffects()
  assert.equal(hook.listeners.size, 0)
  assert.equal(hook.calls.filter(({ command }) => command === 'mole_clean_preview_pty_cancel').length, 1)
  finishReview(complete)
  await review
  assert.equal(hook.render().report, null)
  assert.equal(hook.render().activity, null)
  assert.equal(hook.history.length, 0)
})

test('cancellation during the first listener registration releases it and never starts native review', async () => {
  let finishListener
  const hook = createHook(async (command) => {
    assert.equal(command, 'mole_clean_preview_pty_cancel')
  }, { listen: (_event, _callback, register) => new Promise((resolve) => { finishListener = () => resolve(register()) }) })
  const review = hook.render().review()
  await hook.render().cancel()
  finishListener()
  await review
  assert.equal(hook.listeners.size, 0)
  assert.equal(hook.stopped.length, 1)
  assert.equal(hook.calls.filter(({ command }) => command === 'system_cache_review').length, 0)
})

test('unmount during the second listener registration immediately releases the late listener', async () => {
  let finishListener
  const hook = createHook(async (command) => {
    assert.equal(command, 'mole_clean_preview_pty_cancel')
  }, { listen: (event, _callback, register) => event === 'mole-clean-interaction-request'
    ? new Promise((resolve) => { finishListener = () => resolve(register()) })
    : register() })
  const review = hook.render().review()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(hook.listeners.size, 1)
  hook.unmount()
  assert.equal(hook.listeners.size, 0)
  finishListener()
  await review
  assert.equal(hook.listeners.size, 0)
  assert.equal(hook.stopped.length, 2)
  assert.equal(hook.calls.filter(({ command }) => command === 'system_cache_review').length, 0)
})

for (const exit of ['leave', 'unmount']) {
  test(`${exit} while native cleanup runs cancels it and still records the returned execution outcome`, async () => {
    let finishCleanup
    const hook = createHook(async (command) => {
      if (command === 'system_cache_review') return complete
      if (command === 'system_cache_clean') return new Promise((resolve) => { finishCleanup = resolve })
      assert.equal(command, 'mole_clean_preview_pty_cancel')
    })
    await hook.render().review()
    const cleanup = hook.render().clean()
    await new Promise((resolve) => setImmediate(resolve))
    const currentRun = hook.calls.find(({ command }) => command === 'system_cache_clean').args.runId
    hook.listeners.get('mole-clean-interaction-request')({ payload: { run_id: currentRun, prompt: 'Password:', kind: 'password' } })
    hook.render().setInput('test-password')
    if (exit === 'leave') hook.render(false)
    else hook.unmount()
    assert.equal(hook.listeners.size, 0)
    assert.equal(hook.calls.filter(({ command }) => command === 'mole_clean_preview_pty_cancel').length, 1)
    const updatesBeforeResolution = hook.updates.length
    finishCleanup(outcome)
    await cleanup
    assert.equal(hook.history.length, 1)
    assert.equal(hook.history[0][0], outcome)
    assert.equal(hook.successes.length, 0)
    assert.equal(hook.listeners.size, 0)
    if (exit === 'leave') assert.equal(hook.render(false).input, '')
    else assert.equal(hook.updates.length, updatesBeforeResolution, 'Persist cleanup history without updating an unmounted component')
  })
}
