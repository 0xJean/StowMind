import assert from 'node:assert/strict'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const activity = loadTypeScript('../src/lib/stowmind-supplements/cleanupActivity.ts', {})
const en = loadTypeScript('../src/i18n/en.ts', {}).en
const t = (key, vars = {}) => en[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name]))
const utils = { cn: (...values) => values.filter(Boolean).join(' '), formatDate: String, formatFileSize: (value) => `${value} B` }
const processedSizes = loadTypeScript('../src/pages/statistics/processedSize.ts', { '@/lib/utils': utils })
const record = (summary = {}, overrides = {}) => ({
  id: 'fixture', type: 'clean', executed: true, timestamp: '2026-01-01T00:00:00Z',
  directory: 'Fixture cleanup', totalFiles: 1, categories: {}, moves: [],
  cleanupSummary: { itemCount: 1, action: 'execute', ...summary }, ...overrides,
})
const processed = (size, kind = 'reported') => record({ totalSize: size, sizeKind: 'processed', processedSize: size, processedSizeKind: kind })
const unknown = (extra = {}) => record({ sizeKind: 'unknown', processedSizeKind: 'unavailable', ...extra })

function renderStatistics(history, statistics = {}) {
  const state = { history, categories: [], statistics: { categoryCounts: {}, totalFilesOrganized: 0, ...statistics } }
  const { StatisticsPage } = loadTypeScript('../src/pages/StatisticsPage.tsx', {
    '@/i18n': { useI18n: () => ({ t }) },
    '@/lib/stowmind-supplements/cleanupActivity': activity,
    '@/lib/utils': utils,
    '@/stores/app': { useAppStore: (selector) => selector(state) },
    './statistics/processedSize': processedSizes,
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    react: { useMemo: (fn) => fn() },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  })
  const expand = (element) => {
    if (Array.isArray(element)) return element.map(expand)
    if (!element || typeof element !== 'object') return element
    if (typeof element.type === 'function') return expand(element.type(element.props))
    return { ...element, props: { ...element.props, children: expand(element.props?.children) } }
  }
  const tree = StatisticsPage()
  const tile = findElements(tree, (element) => typeof element.type === 'function' && element.props.meta?.type === 'clean')[0]
  const hero = findElements(tree, (element) => typeof element.type === 'function' && element.props.eyebrow === t('stats.heroSpaceTitle'))[0]
  return { tile: expand(tile), aggregate: tile.props.stat, hero: expand(hero) }
}

for (const missing of [unknown(), record({ sizeKind: 'unknown' }), unknown({ processedSize: 9999 }), unknown({ totalSize: 9999 })]) {
  test(`known processing plus an unmeasured run stays a lower bound: ${JSON.stringify(missing.cleanupSummary)}`, () => {
    for (const history of [[processed(100), missing], [missing, processed(100)]]) {
      const result = renderStatistics(history)
      assert.equal(result.aggregate.processed.bytes, 100)
      assert.equal(result.aggregate.processed.incomplete, true)
      assert.ok(renderedText(result.tile).includes(t('history.spaceProcessedAtLeast', { size: '100 B' })))
      assert.ok(!renderedText(result.tile).includes(t('history.spaceProcessed', { size: '100 B' })))
    }
  })
}

test('all unknown processing values stay absent instead of asserting zero processed bytes', () => {
  const result = renderStatistics([unknown(), record({ sizeKind: 'unknown' })])
  assert.equal(result.aggregate.processed.hasKnownSize, false)
  assert.doesNotMatch(renderedText(result.tile), /\d+ B/)
})

test('complete measured amounts retain their exact recorded sum, including an explicit measured zero', () => {
  const result = renderStatistics([processed(100), processed(250)])
  assert.ok(renderedText(result.tile).includes(t('history.spaceProcessed', { size: '350 B' })))
  assert.equal(result.aggregate.processed.incomplete, false)
  const zero = renderStatistics([processed(0)])
  assert.ok(renderedText(zero.tile).includes(t('history.spaceProcessed', { size: '0 B' })))
  const uncertainZero = renderStatistics([processed(0), unknown()])
  assert.doesNotMatch(renderedText(uncertainZero.tile), /0 B/)
})

test('an explicit lower bound and a partially measured run qualify the aggregate', () => {
  for (const history of [
    [processed(100), processed(250, 'at_least')],
    [processed(100), record({ processedSizeKind: 'partial', sizeKind: 'unknown' })],
  ]) {
    const result = renderStatistics(history)
    assert.equal(result.aggregate.processed.incomplete, true)
    assert.ok(renderedText(result.tile).includes(t('history.spaceProcessedAtLeast', { size: `${result.aggregate.processed.bytes} B` })))
  }
})

test('footer-only completeness remains unspecified when every amount is available', () => {
  const result = renderStatistics([processed(100), processed(250, 'unspecified')])
  assert.ok(renderedText(result.tile).includes(t('history.spaceProcessedUnspecified', { size: '350 B' })))
})

test('physical freed space and processed totals remain independent in the tile and global hero', () => {
  const result = renderStatistics([
    record({ totalSize: 25, sizeKind: 'reported_freed', processedSize: 100, processedSizeKind: 'reported' }),
    processed(200),
  ])
  assert.equal(result.aggregate.freed, 25)
  assert.equal(result.aggregate.processed.bytes, 300)
  assert.ok(renderedText(result.tile).includes(t('stats.typeFreed', { size: '25 B' })))
  assert.ok(renderedText(result.tile).includes(t('history.spaceProcessed', { size: '300 B' })))
  assert.match(renderedText(result.hero), /25 B/)
  assert.doesNotMatch(renderedText(result.hero), /300 B/)
})

test('a physical-only report does not fabricate a processed measurement', () => {
  const physicalOnly = record({ totalSize: 25, sizeKind: 'reported_freed' })
  const alone = renderStatistics([physicalOnly])
  assert.equal(alone.aggregate.processed.hasKnownSize, false)
  assert.ok(!renderedText(alone.tile).includes(t('history.spaceProcessed', { size: '25 B' })))
  const mixed = renderStatistics([physicalOnly, processed(100)])
  assert.ok(renderedText(mixed.tile).includes(t('history.spaceProcessedAtLeast', { size: '100 B' })))
  assert.equal(mixed.aggregate.freed, 25)
})

test('unexecuted or undone unknown runs do not weaken executed measurement precision', () => {
  const result = renderStatistics([processed(100), { ...unknown(), executed: false }, { ...unknown(), undone: true }])
  assert.equal(result.aggregate.count, 1)
  assert.equal(result.aggregate.processed.incomplete, false)
  assert.ok(renderedText(result.tile).includes(t('history.spaceProcessed', { size: '100 B' })))
})
