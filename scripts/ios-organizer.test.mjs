import assert from 'node:assert/strict'
import test from 'node:test'
import { findElement, loadTypeScript } from './ios-organizer-test-harness.mjs'
import './ios-organizer-components.test.mjs'

const settle = () => new Promise((resolve) => setImmediate(resolve))

const ios = loadTypeScript('../src/lib/ios.ts', {
  '@tauri-apps/api/tauri': { invoke: () => assert.fail('Unexpected native call') },
})
const source = {
  id: 'before', deviceName: 'Test iPhone', inventoryHash: 'apps', layoutHash: 'before-layout',
  scanScope: 'homeScreenPages', pages: [{ index: 0 }, { index: 1 }], apps: [],
}
const plan = {
  id: 'plan', sourceSnapshotId: source.id, operations: [{ type: 'moveApp' }],
  targetLayoutHash: 'after-layout', warnings: [],
}
const session = {
  id: 'execution', planId: plan.id, status: 'completed', total: 1, currentIndex: 1,
}
const current = { ...source, id: 'after', layoutHash: 'after-layout' }

const verificationCases = [
  ['matches target, not original', source, plan, session, current, false, null],
  ['unchanged layout is not organized', source, plan, session, source, false, 'layoutChanged'],
  ['changed App set', source, plan, session, { ...current, inventoryHash: 'missing-app' }, false, 'inventoryChanged'],
  ['partial scan', source, plan, session, { ...current, scanScope: 'visiblePage' }, false, 'verificationScope'],
  ['missing page', source, plan, session, { ...current, pages: [{ index: 0 }, { index: 2 }] }, false, 'verificationScope'],
  ['duplicate page', source, plan, session, { ...current, pages: [{ index: 0 }, { index: 0 }] }, false, 'verificationScope'],
  ['partial original scan', { ...source, scanScope: 'visiblePage' }, plan, session, current, false, 'verificationScope'],
  ['wrong source', source, { ...plan, sourceSnapshotId: 'another' }, session, current, false, 'verificationContext'],
  ['wrong plan session', source, plan, { ...session, planId: 'another' }, current, false, 'verificationContext'],
  ['cancelled session', source, plan, { ...session, status: 'cancelled' }, current, false, 'verificationContext'],
  ['failed session', source, plan, { ...session, status: 'failed' }, current, false, 'verificationContext'],
  ['running session', source, plan, { ...session, status: 'running' }, current, false, 'verificationContext'],
  ['partial execution', source, plan, { ...session, currentIndex: 0 }, current, false, 'verificationContext'],
  ['wrong total', source, plan, { ...session, total: 2, currentIndex: 2 }, current, false, 'verificationContext'],
  ['missing target hash', source, { ...plan, targetLayoutHash: undefined }, session, current, false, 'verificationTarget'],
  ['empty target hash', source, { ...plan, targetLayoutHash: ' ' }, session, current, false, 'verificationTarget'],
  ['missing observed layout', source, plan, session, { ...current, layoutHash: undefined }, false, 'layoutChanged'],
  ['missing inventory hashes', { ...source, inventoryHash: '' }, plan, session, { ...current, inventoryHash: '' }, false, 'inventoryChanged'],
  ['stale historical source with completed matching layout', source, plan, session, current, true, null],
  ['stale historical source with changed layout', source, plan, session, source, true, 'layoutChanged'],
  ['stale historical source with changed App set', source, plan, session, { ...current, inventoryHash: 'changed' }, true, 'inventoryChanged'],
  ['stale source cannot verify an unfinished plan', source, plan, { ...session, status: 'paused' }, current, true, 'snapshotStale'],
  ['missing source', null, plan, session, current, false, 'verificationContext'],
  ['missing plan', source, null, session, current, false, 'verificationContext'],
  ['missing session', source, plan, null, current, false, 'verificationContext'],
  ['empty plan is not execution success', source, { ...plan, operations: [] }, { ...session, total: 0, currentIndex: 0 }, current, false, 'noOperations'],
]

for (const [name, before, proposal, execution, after, stale, expected] of verificationCases) {
  test(`verification: ${name}`, () => {
    const actual = ios.getIosVerificationError(before, proposal, execution, after, stale)
    assert.equal(actual === null ? null : actual.split('.').at(-1), expected)
  })
}

test('scope accepts a full scan with App Library and rejects empty pages', () => {
  assert.equal(ios.hasAllHomeScreenPages({ ...current, scanScope: 'homeScreenAndAppLibrary' }), true)
  assert.equal(ios.hasAllHomeScreenPages({ ...current, pages: [] }), false)
})

const jsx = (type, props) => ({ type, props })
const { IosOrganizeActionPanel } = loadTypeScript('../src/pages/ios-organize/IosOrganizeActionPanel.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'lucide-react': new Proxy({}, { get: (_, name) => name }),
  '@/components/AiSetupGuide': { AiSetupGuide: 'AiSetupGuide' },
  '@/i18n': { useI18n: () => ({ t: (key) => key }) },
  '@/lib/ios': ios,
  './IosOrganizeComponents': { Capability: 'Capability', Warning: 'Warning', ProgressBar: 'ProgressBar' },
  './IosPlanPreview': { IosPlanPreview: 'PlanPreview' },
  './IosScanActivity': { IosScanActivity: 'ScanActivity' },
})

for (const [name, overrides, passed] of [
  ['matching completed layout', {}, true],
  ['stale historical source with fresh completed-layout verification', { snapshotStale: true }, true],
  ['verification in progress', { busy: true }, false],
  ['real mirror interaction or unavailable scanning', { canScan: false }, false],
  ['layout mismatch', { verification: source }, false],
  ['older plan', { plan: { ...plan, targetLayoutHash: undefined } }, false],
  ['empty plan', { plan: { ...plan, operations: [] }, session: { ...session, total: 0, currentIndex: 0 } }, false],
]) {
  test(`success banner: ${name}`, () => {
    const rendered = IosOrganizeActionPanel({
      currentStep: 'verify', snapshot: source, plan, session, verification: current,
      snapshotStale: false, busy: false, canScan: true, capabilities: null,
      ...overrides,
    })
    assert.equal(JSON.stringify(rendered).includes('iosOrganize.verifyPassed'), passed)
  })
}

function createPageHarness() {
  const values = []
  const effects = []
  const callbacks = new Map()
  const calls = []
  const responses = new Map([
    ['ios_scan_inventory', source], ['ios_create_plan', plan],
    ['ios_start_execution', session], ['ios_resume_execution', session],
    ['ios_cancel_execution', { ...session, status: 'cancelled' }],
    ['ios_prepare_restore', plan],
  ])
  const appStore = { aiProvider: {}, history: [], aiOnlyHardCases: true }
  appStore.addHistory = (record) => appStore.history.push(record)
  let stateIndex = 0
  let effectIndex = 0
  let queuedEffects = []
  let tree
  const hooks = {
    useState(initial) {
      const index = stateIndex++
      if (!(index in values)) values[index] = initial
      return [values[index], (next) => {
        values[index] = typeof next === 'function' ? next(values[index]) : next
      }]
    },
    useRef(initial) {
      const index = stateIndex++
      if (!(index in values)) values[index] = { current: initial }
      return values[index]
    },
    useMemo: (calculate) => calculate(),
    useEffect(callback, dependencies) {
      const index = effectIndex++
      if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) {
        queuedEffects.push(callback)
        effects[index] = dependencies
      }
    },
  }
  const translate = (key) => key
  const jsx = (type, props) => ({ type, props })
  const nativeApi = { invoke: async (command, args) => {
    calls.push([command, args])
    const response = responses.get(command)
    if (response instanceof Error) throw response
    return typeof response === 'function' ? response(args) : response
  } }
  const inventory = loadTypeScript('../src/pages/ios-organize/useIosInventory.ts', {
    react: hooks,
    '@tauri-apps/api/tauri': nativeApi,
    '@/lib/ios': ios,
  })
  const eventApi = { listen: async (event, callback) => {
    callbacks.set(event, callback)
    return () => callbacks.delete(event)
  } }
  const executionEvents = loadTypeScript('../src/pages/ios-organize/useIosExecutionEvents.ts', {
    react: hooks, '@tauri-apps/api/event': eventApi,
  })
  const { IosOrganizePage } = loadTypeScript('../src/pages/IosOrganizePage.tsx', {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { useLocation: () => ({ pathname: '/ios-organize' }), useNavigate: () => () => {} },
    '@tauri-apps/api/tauri': nativeApi,
    '@tauri-apps/api/process': { relaunch: async () => {} },
    '@/hooks/useAiActivation': { useAiActivation: () => ({ enabled: false, status: 'off' }) },
    '@/i18n': { useI18n: () => ({ t: translate }) },
    '@/lib/ios': ios,
    '@/stores/app': { useAppStore: (select) => select(appStore) },
    './ios-organize/IosOrganizeActionPanel': { IosOrganizeActionPanel: 'ActionPanel' },
    './ios-organize/IosMirrorInteractionCompanion': { IosMirrorInteractionCompanion: 'Companion' },
    './ios-organize/IosOrganizerControlDeck': { IosOrganizerControlDeck: 'ControlDeck' },
    './ios-organize/IosOrganizeComponents': {
      IosDeviceStage: 'DeviceStage', IosOrganizerHeader: 'Header', Warning: 'Warning', WorkflowRail: 'Workflow',
    },
    './ios-organize/useIosCapabilities': { useIosCapabilities: () => ({
      capabilities: { mirrorRunning: true, mirrorContentReady: true },
      canScan: true, canExecute: true, refreshCapabilities: async () => {},
    }) },
    './ios-organize/useIosInventory': inventory,
    './ios-organize/useIosMirrorPreview': { useIosMirrorPreview: () => ({}) },
    './ios-organize/useIosOrganizerLifecycle': { useIosOrganizerLifecycle: () => {} },
    './ios-organize/useIosExecutionEvents': executionEvents,
  }, { window: { confirm: () => true }, document: { documentElement: { dataset: {} } } })
  function render() {
    stateIndex = 0
    effectIndex = 0
    queuedEffects = []
    tree = IosOrganizePage()
    for (const effect of queuedEffects) effect()
    return findElement(tree, 'ActionPanel').props
  }
  render()
  return {
    render, responses, calls, history: appStore.history,
    warning: () => findElement(tree, 'ControlDeck')?.props.warning,
    enterInteraction: () => findElement(tree, 'DeviceStage').props.onEnterInteraction(),
    exitInteraction: () => findElement(tree, 'Companion').props.onExit(),
    interactionDisabled: () => findElement(tree, 'DeviceStage')?.props.interactionDisabled,
    event: (name, payload) => callbacks.get(name)({ payload }),
    async completeAndVerify() {
      await render().onScan()
      await render().onCreatePlan()
      await render().onExecute()
      responses.set('ios_scan_inventory', current)
      await render().onVerify()
      assert.equal(render().verification, current)
    },
  }
}

for (const [action, command] of [
  ['onVerify', 'ios_scan_inventory'],
  ['onScan', 'ios_scan_inventory'],
  ['onCreatePlan', 'ios_create_plan'],
  ['onPrepareRestore', 'ios_prepare_restore'],
  ['onResume', 'ios_resume_execution'],
]) {
  test(`page clears old verification when ${action} fails`, async () => {
    const page = createPageHarness()
    await page.completeAndVerify()
    page.responses.set(command, new Error('request failed'))
    await page.render()[action]()
    const state = page.render()
    assert.equal(state.verification, null)
    assert.match(page.warning(), /request failed/)
    if (action === 'onScan') assert.equal(state.snapshotStale, true)
  })
}

test('page clears success as soon as a new verification starts', async () => {
  const page = createPageHarness()
  await page.completeAndVerify()
  let finish
  page.responses.set('ios_scan_inventory', () => new Promise((resolve) => { finish = resolve }))
  const pending = page.render().onVerify()
  assert.equal(page.render().verification, null)
  assert.equal(page.render().busy, true)
  await settle()
  finish(current)
  await pending
  assert.equal(page.render().verification, current)
})

for (const status of ['paused', 'failed']) {
  test(`late ${status} execution event cannot replace a completed session`, async () => {
    const page = createPageHarness()
    await page.completeAndVerify()
    page.event(`ios-execution-${status}`, { ...session, status })
    assert.equal(page.render().verification, current)
    assert.equal(page.render().session.status, 'completed')
  })
}

test('late execution progress cannot replace a completed session', async () => {
  const page = createPageHarness()
  await page.completeAndVerify()
  page.event('ios-execution-progress', {
    sessionId: session.id, current: 0, total: 1, status: 'running', message: 'Checking',
  })
  assert.equal(page.render().verification, current)
  assert.equal(page.render().session.status, 'completed')
})

test('page clears success before entering real mirror interaction', async () => {
  const page = createPageHarness()
  await page.completeAndVerify()
  page.enterInteraction()
  assert.equal(page.render().verification, null)
})

for (const status of ['failed', 'cancelled']) {
  test(`page allows a fresh scan after ${status} execution`, async () => {
    const page = createPageHarness()
    await page.render().onScan()
    await page.render().onCreatePlan()
    page.responses.set('ios_start_execution', { ...session, status })
    await page.render().onExecute()
    assert.equal(page.render().currentStep, 'execute')
    assert.equal(page.render().verification, null)
    assert.equal(page.render().busy, false)
    page.responses.set('ios_scan_inventory', current)
    await page.render().onScan()
    const state = page.render()
    assert.equal(state.currentStep, 'plan')
    assert.equal(state.plan, null)
    assert.equal(state.session, null)
    assert.equal(state.snapshotStale, false)
  })
}

test('page blocks an empty plan before invoking execution or writing completion history', async () => {
  const page = createPageHarness()
  await page.render().onScan()
  page.responses.set('ios_create_plan', { ...plan, operations: [] })
  await page.render().onCreatePlan()
  await page.render().onExecute()
  assert.equal(page.calls.some(([command]) => command === 'ios_start_execution'), false)
  assert.equal(page.history.length, 0)
  assert.equal(page.render().verification, null)
  assert.equal(page.warning(), 'iosOrganize.error.noOperations')
})

test('manual edit guidance completes through interaction and fresh full verification', async () => {
  const page = createPageHarness()
  await page.render().onScan()
  await page.render().onCreatePlan()
  page.responses.set('ios_start_execution', { ...session, status: 'paused', currentIndex: 0, guidanceCanResume: true })
  await page.render().onExecute()
  assert.equal(page.render().currentStep, 'execute')
  page.enterInteraction()
  assert.equal(page.render().mirrorMode, 'interaction')
  await page.render().onResume()
  assert.equal(page.render().session.status, 'completed')
  page.exitInteraction()
  let state = page.render()
  assert.equal(state.mirrorMode, 'preview')
  assert.equal(state.currentStep, 'verify')
  assert.equal(state.snapshotStale, true)
  assert.equal(state.plan, plan)
  const previousCalls = page.calls.length
  await state.onCreatePlan()
  await state.onExecute()
  assert.equal(page.calls.length, previousCalls, 'stale source must never drive planning or execution')
  page.responses.set('ios_scan_inventory', current)
  await page.render().onVerify()
  state = page.render()
  assert.equal(state.verification, current)
  assert.equal(ios.getIosVerificationError(state.snapshot, state.plan, state.session, state.verification, state.snapshotStale), null)
})

test('exiting interaction before execution completes invalidates the executable plan', async () => {
  const page = createPageHarness()
  await page.render().onScan()
  await page.render().onCreatePlan()
  page.responses.set('ios_start_execution', { ...session, status: 'paused', currentIndex: 0, guidanceCanResume: true })
  await page.render().onExecute()
  page.enterInteraction()
  page.render()
  page.exitInteraction()
  const state = page.render()
  assert.equal(state.snapshotStale, true)
  assert.equal(state.plan, null)
  const callsBeforeResume = page.calls.length
  await state.onResume()
  assert.equal(page.calls.length, callsBeforeResume)
})

test('in-flight scan blocks immediate interaction and exposes cancellation until completion', async () => {
  const page = createPageHarness()
  let finish
  page.responses.set('ios_scan_inventory', () => new Promise((resolve) => { finish = resolve }))
  const pending = page.render().onScan()
  await settle()
  page.enterInteraction()
  let state = page.render()
  assert.equal(state.mirrorMode, 'preview')
  assert.equal(page.interactionDisabled(), true)
  assert.equal(state.scanning, true)
  await state.onCancelScan()
  assert.equal(page.calls.at(-1)[0], 'ios_cancel_inventory')
  assert.equal(page.render().busy, true)
  assert.equal(page.render().scanning, true)
  finish(source)
  await pending
  assert.equal(page.render().scanning, false)
})

test('cancellation cannot be undone by a late progress, event, or invocation result', async () => {
  const page = createPageHarness()
  await page.render().onScan()
  await page.render().onCreatePlan()
  let finish
  page.responses.set('ios_start_execution', () => new Promise((resolve) => { finish = resolve }))
  const pending = page.render().onExecute()
  page.event('ios-execution-progress', { sessionId: session.id, status: 'running', current: 0, total: 1, message: 'Checking' })
  await page.render().onCancel()
  page.event('ios-execution-progress', { sessionId: session.id, status: 'running', current: 1, total: 1, message: 'Late' })
  page.event('ios-execution-completed', session)
  finish(session)
  await pending
  const state = page.render()
  assert.equal(state.session.status, 'cancelled')
  assert.equal(state.verification, null)
  assert.equal(page.history.length, 0)
})

test('emergency cancellation of a paused session updates UI and rejects later guidance', async () => {
  const page = createPageHarness()
  await page.render().onScan()
  await page.render().onCreatePlan()
  const paused = { ...session, status: 'paused', currentIndex: 0, guidanceCanResume: true }
  page.responses.set('ios_start_execution', paused)
  await page.render().onExecute()
  page.event('ios-execution-cancelled', { ...paused, status: 'cancelled' })
  let state = page.render()
  assert.equal(state.session.status, 'cancelled')
  assert.equal(state.session.guidanceCanResume, false)
  assert.equal(state.busy, false)
  page.event('ios-execution-paused', paused)
  state = page.render()
  assert.equal(state.session.status, 'cancelled')
})

test('scan cancellation failures remain retryable until the original scan stops', async () => {
  const page = createPageHarness()
  let finish
  page.responses.set('ios_scan_inventory', () => new Promise((resolve) => { finish = resolve }))
  page.responses.set('ios_cancel_inventory', new Error('cancel failed'))
  const pending = page.render().onScan()
  await settle()
  assert.equal(await page.render().onCancelScan(), false)
  page.render()
  assert.match(page.warning(), /cancel failed/)
  page.responses.set('ios_cancel_inventory', true)
  assert.equal(await page.render().onCancelScan(), true)
  assert.equal(page.render().scanning, true)
  finish(source)
  await pending
})

test('a new inventory is not replaced by late events from the previous session', async () => {
  const page = createPageHarness()
  await page.completeAndVerify()
  await page.render().onScan()
  page.event('ios-execution-cancelled', { ...session, status: 'cancelled' })
  page.event('ios-execution-completed', session)
  const state = page.render()
  assert.equal(state.session, null)
  assert.equal(state.currentStep, 'plan')
})

test('companion exit cannot race resume or restore the window before its native request finishes', async () => {
  const page = createPageHarness()
  await page.render().onScan()
  await page.render().onCreatePlan()
  page.responses.set('ios_start_execution', { ...session, status: 'paused', currentIndex: 0, guidanceCanResume: true })
  await page.render().onExecute()
  page.enterInteraction()
  let finish
  page.responses.set('ios_resume_execution', () => new Promise((resolve) => { finish = resolve }))
  const pending = page.render().onResume()
  page.exitInteraction()
  assert.equal(page.render().mirrorMode, 'interaction', 'same-frame click must respect the synchronous request gate')
  page.event('ios-execution-completed', session)
  page.render()
  page.exitInteraction()
  assert.equal(page.render().mirrorMode, 'interaction', 'completed event cannot release an in-flight request')
  finish(session)
  await pending
  page.render()
  page.exitInteraction()
  assert.equal(page.render().mirrorMode, 'preview')
  assert.equal(page.render().currentStep, 'verify')
})
