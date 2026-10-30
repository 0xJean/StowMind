import assert from 'node:assert/strict'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'
import { createPage, t, button, settle, agentPreview, cacheReport, authorizedReport, cacheOutcome } from './agent-cleanup-test-harness.mjs'

test('entry starts one Agent scan and one independent system scan', async () => {
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
  // The complete-but-unauthorized measurement chains the administrator
  // review from the same scan entry; destructive actions still need the
  // shared bottom confirmation.
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_review').length, 1)
  assert.equal(page.calls.some(({ command }) => command === 'system_cache_clean'), false)
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
    if (command === 'system_cache_scan') return cacheReport
    if (command === 'system_cache_review') return cacheReport
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
    if (command === 'system_cache_review') return { ...cacheReport, status: 'permission_denied', size_bytes: null, authorized: false }
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
  const page = createPage((command, _args, fallback) => command === 'system_cache_scan' || command === 'system_cache_review'
    ? { ...cacheReport, status: 'permission_denied', size_bytes: null, anomaly: null, authorized: false }
    : fallback())
  page.render()
  await settle()
  const shared = page.shared(page.render())
  const text = renderedText(shared.tree)
  for (const key of ['systemCache.sharedTitle', 'systemCache.sharedDescription', 'systemCache.sharedScopeHint', 'systemCache.unknownSize']) assert.ok(text.includes(t(key)))
  assert.equal(findElements(shared.tree, (element) => element.props?.type === 'checkbox').length, 0)
  assert.equal(button(shared.tree, t('systemCache.clean')), undefined, 'cleanup is no longer a separate card action')
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
  // The unauthorized measurement chains review on each scan; the bottom
  // action confirms both the agent items and the reviewed cache together.
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_review').length, 2)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_clean').length, 1)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 2, 'Agent execution refreshes the separate read-only cache probe')
  assert.equal(page.history.length, 2)
  assert.equal(page.history[0].type, 'agent-cleanup')
  assert.equal(page.history[1].type, 'system-cache')
  assert.equal(page.history[0].cleanupSummary.totalSize, 384)
  assert.equal(page.history[0].cleanupSummary.sizeKind, 'processed')
  assert.equal(page.store.statistics.agentCleanupProcessedBytes, 384)
  assert.equal(page.store.statistics.agentCleanupSizeFreed, undefined)
  assert.equal(page.store.statistics.systemCacheCleanupCount, 1)
})

test('administrator review is triggered by the scan entry and cleanup joins the shared bottom action', async () => {
  const page = createPage()
  page.render()
  await settle()
  await settle()
  // The initial scan auto-requested the administrator review because the
  // measured cache was unauthorized.
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_review').length, 1)
  assert.equal(page.shared(page.render()).props.cache.report.review_token, 'one-time-token')
  assert.equal(button(page.shared(page.render()).tree, t('systemCache.clean')), undefined, 'cleanup is not a separate card action')
  button(page.render(), t('agentCleanup.cleanSelected')).props.onClick()
  await settle()
  let tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 0, size: '0 bytes' })))
  const execution = page.calls.find(({ command }) => command === 'system_cache_clean')
  assert.equal(execution.args.reviewToken, 'one-time-token')
  assert.equal(execution.args.confirmed, true)
  assert.equal(page.calls.some(({ command }) => command === 'agent_cleanup_execute'), true)
  assert.equal(page.history.length, 2)
  assert.equal(page.history[0].type, 'agent-cleanup')
  assert.equal(page.history[1].type, 'system-cache')
  assert.equal(page.store.statistics.systemCacheCleanupCount, 1)
  assert.equal(page.store.statistics.agentCleanupSizeFreed, undefined)
})

test('returning to the Agent page refreshes shared authorization without resetting Agent manual selections', async () => {
  const page = createPage()
  page.render()
  await settle()
  button(page.render(), t('agentCleanup.toggleAll')).props.onClick()
  assert.equal(page.shared(page.render()).props.cache.report.review_token, 'one-time-token')
  page.setPath('/doctor')
  assert.equal(page.shared(page.render()).props.active, false)
  page.setPath('/agent-cleanup')
  page.render()
  await settle()
  const tree = page.render()
  assert.equal(page.calls.filter(({ command }) => command === 'agent_cleanup_scan').length, 1)
  assert.equal(page.calls.filter(({ command }) => command === 'system_cache_scan').length, 2)
  assert.equal(page.shared(tree).props.cache.report.review_token, 'one-time-token')
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 2, size: '384 bytes' })))
})

test('leaving the Agent page cancels its shared cleanup and preserves the failed system history', async () => {
  let finishCleanup
  const page = createPage((command, _args, fallback) => command === 'system_cache_clean'
    ? new Promise((resolve) => { finishCleanup = resolve })
    : fallback())
  page.render()
  await settle()
  // Scan auto-ran the review; clean now starts from the shared bottom action.
  button(page.render(), t('agentCleanup.cleanSelected')).props.onClick()
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
  const systemRecord = page.history.find((record) => record.type === 'system-cache')
  assert.equal(systemRecord.cleanupSummary.outcome, 'failed')
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

for (const [name, measured, label] of [
  ['partial bytes', [{ size: 128, size_status: 'complete' }, { size: 256, size_status: 'partial' }], t('clean.summary.atLeast', { size: '384 bytes' })],
  ['unknown entries beside measured bytes', [{ size: 128, size_status: 'complete' }, { size: 9999, size_status: 'unavailable' }], t('clean.summary.atLeast', { size: '128 bytes' })],
  ['only unknown bytes', [{ size: 0, size_status: 'partial' }, { size: 0, size_status: 'unavailable' }], t('clean.summary.unknown')],
  ['measured empty items', [{ size: 0, size_status: 'complete' }], '0 bytes'],
]) {
  test(`Agent group, selected total and execution confirmation agree for ${name}`, async () => {
    const items = measured.map((measurement, index) => ({
      ...agentPreview.items[0], ...measurement, id: `measurement-${index}`, path: `/fixture/agent-${index}`,
    }))
    const page = createPage((command, _args, fallback) => command === 'agent_cleanup_scan'
      ? { ...agentPreview, items } : fallback())
    page.render(); await settle()
    const tree = page.render()
    assert.ok(renderedText(tree).includes(t('agentCleanup.groupSummary', { count: items.length, selected: items.length, size: label })))
    assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: items.length, size: label })))
    button(tree, t('agentCleanup.cleanSelected')).props.onClick()
    await settle()
    assert.equal(page.confirmations[0], t('agentCleanup.confirm', { count: items.length, size: label, cache: t('agentCleanup.confirmCacheSuffix') }))
    assert.deepEqual(page.calls.find((call) => call.command === 'agent_cleanup_execute').args.request.itemIds, items.map((item) => item.id))
  })
}

test('a protected unknown item qualifies its group without contaminating the selected size', async () => {
  const page = createPage((command, _args, fallback) => command === 'agent_cleanup_scan' ? {
    ...agentPreview, items: [
      { ...agentPreview.items[0], size_status: 'complete' },
      { ...agentPreview.items[3], size: 9999, size_status: 'unavailable' },
    ],
  } : fallback())
  page.render(); await settle()
  const tree = page.render()
  assert.ok(renderedText(tree).includes(t('agentCleanup.groupSummary', { count: 2, selected: 1, size: t('clean.summary.atLeast', { size: '128 bytes' }) })))
  assert.ok(renderedText(tree).includes(t('agentCleanup.selectedSummary', { count: 1, size: '128 bytes' })))
  button(tree, t('agentCleanup.cleanSelected')).props.onClick()
  await settle()
  assert.equal(page.confirmations[0], t('agentCleanup.confirm', { count: 1, size: '128 bytes', cache: t('agentCleanup.confirmCacheSuffix') }))
})
