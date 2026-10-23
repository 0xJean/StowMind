import assert from 'node:assert/strict'
import test from 'node:test'
import { findElement, jsx, loadTypeScript } from './ios-organizer-test-harness.mjs'

const preview = {
  potential_space: 1024, item_count: 2, category_count: 1,
  summary_status: 'at_least', scan_status: 'complete',
  sections: [{ title: 'Caches', items: [{ label: 'Preview cache', status: 'dry_run', size: 1024, count: 2 }] }],
  raw_output: 'Dry run complete\nPotential space: At least 1KB | Items: 2 | Categories: 1',
}
const scopeA = '/Volumes/Preview-A'
const scopeB = '/Volumes/Unreviewed-B'
const settle = () => new Promise((resolve) => setImmediate(resolve))

function createPage(pending = null) {
  const states = []
  const effects = []
  const calls = []
  const notices = []
  const listeners = new Set()
  let cursor = 0
  let persisted = pending ? { key: 'mole.clean.preview', schemaVersion: 1, payload: pending } : null
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
    assert.fail(`No native cleanup or unexpected IPC is allowed: ${command}`)
  }
  const resultCache = loadTypeScript('../src/lib/resultCache.ts', { '@tauri-apps/api/tauri': { invoke } })
  const snapshots = loadTypeScript('../src/pages/clean/cleanScanSnapshot.ts', { '@/lib/resultCache': resultCache })
  const summary = loadTypeScript('../src/pages/clean/cleanPreviewSummary.ts', {
    '@/lib/utils': { formatFileSize: String },
  })
  const types = loadTypeScript('../src/pages/clean/types.ts', {})
  const components = Object.fromEntries([
    'CleanCompletedPanel', 'CleanInteractionPrompt', 'PendingCleanScanCard',
    'CleanResultsPanel', 'CleanScopeControls', 'CleanScanCard',
  ].map((name) => [`./clean/${name}`, { [name]: name }]))
  const { CleanPage } = loadTypeScript('../src/pages/CleanPage.tsx', {
    ...components, react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/ui/card': { Card: 'Card', CardContent: 'CardContent' },
    '@/i18n': { useI18n: () => ({ t: (key) => key }) },
    '@tauri-apps/api/tauri': { invoke },
    '@tauri-apps/api/event': { listen: async (name) => {
      listeners.add(name)
      return () => listeners.delete(name)
    } },
    'lucide-react': { ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight', FileText: 'FileText' },
    'react-toastify': { toast: Object.fromEntries(['warning', 'success', 'info', 'error'].map((kind) => [kind, (message) => notices.push({ kind, message })])) },
    './clean/cleanScanSnapshot': snapshots,
    './clean/cleanPreviewSummary': summary,
    './clean/types': types,
    './clean/cleanFailureHints': { hasDiskAccessFailure: () => false },
    './clean/cleanExecutionResult': { splitCleanOperationLog: () => assert.fail('No execution result is expected') },
    './clean/cleanCompletion': { recordCleanCompletion: () => assert.fail('No cleanup may be recorded') },
    './clean/useCleanPtyInteraction': { useCleanPtyInteraction: () => ({ reset() {}, open() {}, submit() {}, cancel() {}, setValue() {} }) },
  }, { window: { setInterval: () => 1, clearInterval() {} } })
  return {
    calls, notices, listeners,
    scans: () => calls.filter(({ command }) => command === 'mole_clean_preview_pty'),
    saved: () => persisted?.payload,
    render() {
      cursor = 0
      const tree = CleanPage()
      effects.splice(0).forEach((effect) => effect())
      return tree
    },
  }
}

test('changing scan scope clears the old result and blocks queued or current cleanup of an unreviewed path', async () => {
  const page = createPage()
  page.render()
  await settle()
  findElement(page.render(), 'CleanScanCard').props.scopeControls.props.onExternalPathChange(scopeA)
  findElement(page.render(), 'CleanScanCard').props.onScan()
  await settle()
  let tree = page.render()
  assert.equal(page.scans()[0].args.externalPath, scopeA)
  assert.equal(findElement(tree, 'CleanResultsPanel').props.preview, preview)
  const queuedClean = findElement(tree, 'CleanResultsPanel').props.onClean

  findElement(tree, 'CleanScanCard').props.scopeControls.props.onExternalPathChange(scopeB)
  tree = page.render()
  assert.equal(findElement(tree, 'CleanResultsPanel'), null, 'Old results disappear as soon as the scope changes')
  assert.equal(findElement(tree, 'CleanScanCard').props.preview, null)
  assert.equal(findElement(tree, 'CleanScanCard').props.scopeControls.props.externalPath, scopeB)
  queuedClean()
  findElement(tree, 'CleanScanCard').props.onClean()
  await settle()
  assert.equal(page.calls.some(({ command }) => command === 'mole_clean_execute_pty'), false)
  assert.ok(page.notices.some(({ kind, message }) => kind === 'warning' && message === 'clean.summary.rescanRequired'))

  findElement(page.render(), 'CleanScanCard').props.onScan()
  await settle()
  assert.equal(page.scans().length, 2)
  assert.equal(page.scans()[1].args.externalPath, scopeB)
  assert.equal(page.saved().externalPath, scopeB)
  assert.ok(findElement(page.render(), 'CleanResultsPanel'))
  assert.equal(page.listeners.size, 0)
})

for (const restore of ['view', 'rescan']) {
  test(`a pending scan can ${restore} and scan again using its original external scope`, async () => {
    const pending = {
      id: 'pending-scope-a', status: 'pending', createdAt: '2026-10-23T00:00:00Z',
      updatedAt: '2026-10-23T00:00:00Z', externalPath: scopeA, preview,
    }
    const page = createPage(pending)
    page.render()
    await settle()
    const choice = findElement(page.render(), 'PendingCleanScanCard')
    assert.equal(choice.props.snapshot.externalPath, scopeA)
    assert.equal(page.scans().length, 0, 'Loading a saved preview must not execute or automatically rescan')
    if (restore === 'view') {
      choice.props.onView()
      const tree = page.render()
      assert.equal(findElement(tree, 'CleanScanCard').props.scopeControls.props.externalPath, scopeA)
      assert.equal(findElement(tree, 'CleanResultsPanel').props.preview, preview)
      findElement(tree, 'CleanScanCard').props.onScan()
    } else choice.props.onRescan()
    await settle()
    assert.equal(page.scans().length, 1)
    assert.equal(page.scans()[0].args.externalPath, scopeA)
    assert.equal(page.saved().externalPath, scopeA)
    assert.ok(findElement(page.render(), 'CleanResultsPanel'))
    assert.equal(page.calls.some(({ command }) => command === 'mole_clean_execute_pty'), false)
    assert.equal(page.listeners.size, 0)
  })
}

test('a restored preview with an unavailable summary cannot bypass the page-level cleanup guard', async () => {
  const pending = {
    id: 'pending-incomplete', status: 'pending', createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z', externalPath: scopeA,
    preview: { ...preview, potential_space: null, summary_status: 'unavailable' },
  }
  const page = createPage(pending)
  page.render()
  await settle()
  findElement(page.render(), 'PendingCleanScanCard').props.onView()
  const tree = page.render()
  assert.equal(findElement(tree, 'CleanScanCard').props.scopeControls.props.externalPath, scopeA)
  findElement(tree, 'CleanResultsPanel').props.onClean()
  findElement(tree, 'CleanScanCard').props.onClean()
  await settle()
  assert.equal(page.calls.some(({ command }) => command === 'mole_clean_execute_pty'), false)
  assert.equal(page.notices.filter(({ kind }) => kind === 'warning').length, 2)
  assert.equal(page.scans().length, 0)
})
