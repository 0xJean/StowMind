import assert from 'node:assert/strict'
import test from 'node:test'
import { findElement, findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const { zh } = loadTypeScript('../src/i18n/zh.ts', {})
const t = (key, parameters = {}) => {
  assert.ok(key in zh, `Missing Chinese translation: ${key}`)
  return zh[key].replace(/\{(\w+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`))
}
const common = {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'lucide-react': new Proxy({}, { get: (_, name) => name }),
  '@/i18n': { useI18n: () => ({ t }) },
}
const components = loadTypeScript('../src/pages/ios-organize/IosOrganizeComponents.tsx', common)
const { IosPlanPreview } = loadTypeScript('../src/pages/ios-organize/IosPlanPreview.tsx', {
  ...common, './IosOrganizeComponents': components,
})
const ios = loadTypeScript('../src/lib/ios.ts', {
  '@tauri-apps/api/tauri': { invoke: () => assert.fail('Unexpected native call') },
})
const { IosOrganizeActionPanel } = loadTypeScript('../src/pages/ios-organize/IosOrganizeActionPanel.tsx', {
  ...common,
  '@/components/AiSetupGuide': { AiSetupGuide: 'AiSetupGuide' },
  '@/lib/ios': ios,
  './IosOrganizeComponents': components,
  './IosPlanPreview': { IosPlanPreview },
  './IosScanActivity': { IosScanActivity: 'ScanActivity' },
})
const buttonWithText = (tree, text) => findElements(tree,
  (element) => element.type === 'button' && renderedText(element).includes(text))[0]

test('empty plan explains the limitation and offers recovery without an execution button', () => {
  let rescans = 0
  let changes = 0
  const tree = IosPlanPreview({
    plan: { operations: [], warnings: ['没有安全空位'] }, snapshot: null,
    busy: false, canExecute: true, canScan: true, hasSession: false,
    onExecute: () => assert.fail('Empty plan must not execute'),
    onScan: () => { rescans += 1 }, onChangePlan: () => { changes += 1 },
  })
  assert.ok(renderedText(tree).includes(t('iosOrganize.preview.emptyTitle')))
  assert.ok(renderedText(tree).includes(t('iosOrganize.preview.emptyHelp')))
  assert.equal(buttonWithText(tree, t('iosOrganize.execute')), undefined)
  assert.equal(findElement(tree, 'ol'), null)
  assert.equal(findElement(tree, 'details').props.open, true)
  buttonWithText(tree, t('iosOrganize.rescan')).props.onClick()
  buttonWithText(tree, t('iosOrganize.visual.changePlan')).props.onClick()
  assert.equal(rescans, 1)
  assert.equal(changes, 1)
})

test('preview exposes every action beyond twelve, with readable one-based origin and destination', () => {
  const operations = Array.from({ length: 16 }, (_, index) => ({
    type: 'moveApp', appId: `app-${index}`,
    fromPage: 1, fromRow: 5, fromColumn: index % 4,
    toPage: 1, toRow: 1, toColumn: (index + 1) % 4,
  }))
  const snapshot = { apps: operations.map((operation, index) => ({ id: operation.appId, name: `应用${index + 1}` })) }
  const tree = IosPlanPreview({
    plan: { operations, warnings: ['Manual-only suggestions'] }, snapshot,
    busy: false, canExecute: true, canScan: true, hasSession: false,
  })
  const list = findElement(tree, 'ol')
  const rows = findElements(list, (element) => element.type === 'li')
  assert.equal(rows.length, operations.length)
  assert.equal(list.props.tabIndex, 0, 'long action lists must remain keyboard-scrollable')
  assert.equal(findElement(tree, 'details').props.open, false, 'suggestions must not bury the action list')
  for (let index = 0; index < operations.length; index += 1) {
    const expected = t('iosOrganize.operation.move', {
      app: `应用${index + 1}`, fromPage: 2, fromRow: 6, fromColumn: index % 4 + 1,
      toPage: 2, toRow: 2, toColumn: (index + 1) % 4 + 1,
    })
    assert.ok(renderedText(rows[index]).includes(expected))
  }
  const first = renderedText(rows[0])
  assert.match(first, /第 2 页.*6 行.*1 列/)
  assert.match(first, /2 行.*2 列/)
})

function createActivity(onCancel) {
  const state = []
  let cursor = 0
  let mounted = false
  let tick
  let time = 0
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useEffect(effect) { if (!mounted) effect() },
  }
  const { IosScanActivity } = loadTypeScript('../src/pages/ios-organize/IosScanActivity.tsx', {
    ...common, react: hooks,
  }, {
    Date: { now: () => time },
    window: { setInterval: (callback) => { tick = callback; return 1 }, clearInterval: () => {} },
  })
  return {
    render() {
      cursor = 0
      const tree = IosScanActivity({ onCancel })
      mounted = true
      return tree
    },
    advance(seconds) { time = seconds * 1000; tick() },
  }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('scan activity reports elapsed time and keeps successful stop disabled until the scan exits', async () => {
  let finish
  const activity = createActivity(() => new Promise((resolve) => { finish = resolve }))
  let tree = activity.render()
  assert.ok(renderedText(tree).includes(t('iosOrganize.scan.emergencyStop')))
  activity.advance(12)
  tree = activity.render()
  assert.ok(renderedText(tree).includes(t('iosOrganize.scan.elapsed', { seconds: 12 })))
  findElement(tree, 'button').props.onClick()
  assert.equal(findElement(activity.render(), 'button').props.disabled, true)
  finish(true)
  await settle()
  tree = activity.render()
  assert.equal(findElement(tree, 'button').props.disabled, true)
  assert.ok(renderedText(tree).includes(t('iosOrganize.scan.stopping')))
})

for (const failure of ['false', 'throw']) {
  test(`scan activity lets the user retry cancellation after ${failure}`, async () => {
    let attempts = 0
    const activity = createActivity(async () => {
      attempts += 1
      if (attempts > 1) return true
      if (failure === 'throw') throw new Error('Cancellation unavailable')
      return false
    })
    findElement(activity.render(), 'button').props.onClick()
    await settle()
    let tree = activity.render()
    assert.equal(findElement(tree, 'button').props.disabled, false)
    if (failure === 'throw') {
      assert.match(renderedText(findElements(tree, (element) => element.props?.role === 'alert')[0]), /Cancellation unavailable/)
    }
    findElement(tree, 'button').props.onClick()
    await settle()
    tree = activity.render()
    assert.equal(attempts, 2)
    assert.equal(findElement(tree, 'button').props.disabled, true)
    assert.equal(findElements(tree, (element) => element.props?.role === 'alert').length, 0)
  })
}

test('completed interaction gives the finish-editing instruction and a working return-to-verify action', () => {
  let exits = 0
  const tree = IosOrganizeActionPanel({
    currentStep: 'verify', mirrorMode: 'interaction', session: { status: 'completed' },
    busy: false, scanning: false, canScan: false, capabilities: null,
    onExitInteraction: () => { exits += 1 },
    onVerify: () => assert.fail('Do not start a scan inside interaction mode'),
  })
  assert.ok(renderedText(tree).includes(t('iosOrganize.interaction.finishEditing')))
  assert.ok(renderedText(tree).includes(t('iosOrganize.interaction.finishHelp')))
  assert.equal(buttonWithText(tree, t('iosOrganize.verify')), undefined)
  const exit = buttonWithText(tree, t('iosOrganize.interaction.returnVerify'))
  assert.equal(exit.props.disabled, false)
  exit.props.onClick()
  assert.equal(exits, 1)
})

test('completed interaction waits for the native request before offering a return action', () => {
  const tree = IosOrganizeActionPanel({
    currentStep: 'verify', mirrorMode: 'interaction', session: { status: 'completed' },
    busy: true, scanning: false, canScan: false, capabilities: null,
  })
  assert.equal(buttonWithText(tree, t('iosOrganize.interaction.returnVerify')).props.disabled, true)
})
