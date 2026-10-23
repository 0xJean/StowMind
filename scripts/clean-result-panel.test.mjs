import assert from 'node:assert/strict'
import test from 'node:test'
import { findElements, jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const en = loadTypeScript('../src/i18n/en.ts', {}).en
const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key] ?? key)
const records = [
  ...Array.from({ length: 946 }, (_, index) => ({ action: 'REMOVED', label: `/fixture/log-${index}${index === 0 ? ' (batch)' : ' (8KB)'}`, runId: 'fixture-run' })),
  ...Array.from({ length: 4 }, (_, index) => ({ action: 'FAILED', label: `/fixture/failure-${index} (removal timed out)`, runId: 'fixture-run' })),
  ...Array.from({ length: 173 }, (_, index) => ({ action: 'SKIPPED', label: `/fixture/protected-${index} (whitelist)`, runId: 'fixture-run' })),
]
const summary = {
  itemCount: 511, itemCountSource: 'mole', totalSize: null,
  processedSize: 10_640_781_476, processedSizeKind: 'reported',
  operationCount: 946, failedCount: 4, skippedCount: 173, operationLogStatus: 'available',
}
const stdout = 'Initial diagnostic kept\nTracked cleanup: 9.91GB | Items cleaned: 511\nFree space: 42.00GB (+1.00GB)'
const operationLog = records.map((record) => `[2026-01-01 12:00:00] [clean run=fixture-run] ${record.action} ${record.label}`).join('\n')
const baseProps = {
  preview: { potential_space: null, item_count: 511, category_count: null, sections: [] }, summary,
  rawOutput: `${stdout}\n\nMole operation log:\n${operationLog}`,
  outputLines: ['Only a late live-output line'], completedAt: '2026-01-01T12:00:00Z', elapsedMs: 438_000,
  status: 'partial', onRescan() {},
}

function fixture({ parsedRecords = records, fallbackSummary = summary } = {}) {
  let cursor = 0
  const slots = []
  const react = {
    useMemo: (fn) => fn(),
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
  }
  const common = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/i18n': { useI18n: () => ({ t }) },
    '@/lib/utils': { formatFileSize: (value) => `${value} B` },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((name) => [name, name])),
    'lucide-react': Object.fromEntries(['AlertCircle', 'Ban', 'CheckCircle2', 'Clock', 'Database', 'Files', 'RefreshCw', 'ChevronDown', 'ChevronRight', 'SkipForward'].map((name) => [name, name])),
  }
  const ledger = loadTypeScript('../src/pages/clean/CleanOperationLogPanel.tsx', common)
  const output = loadTypeScript('../src/pages/clean/CleanExecutionOutputPanel.tsx', common)
  const panel = loadTypeScript('../src/pages/clean/CleanCompletedPanel.tsx', {
    ...common, './CleanOperationLogPanel': ledger, './CleanExecutionOutputPanel': output,
    './CleanScanStatusPanel': { formatElapsed: (value) => `${value} ms` },
    './cleanExecutionResult': {
      parseCleanOperationLog: () => parsedRecords,
      summarizeCleanExecution: () => fallbackSummary,
      splitCleanOperationLog(value) {
        const marker = 'Mole operation log:', index = value.indexOf(marker)
        return index < 0 ? { rawOutput: value, operationLog: '' }
          : { rawOutput: value.slice(0, index).trim(), operationLog: value.slice(index + marker.length).trim() }
      },
    },
  })
  const expand = (element) => {
    if (Array.isArray(element)) return element.map(expand)
    if (!element || typeof element !== 'object') return element
    if (typeof element.type === 'function') return expand(element.type(element.props))
    return { ...element, props: { ...element.props, children: expand(element.props?.children) } }
  }
  return {
    render(props = baseProps) { cursor = 0; return expand(panel.CleanCompletedPanel(props)) },
    output(value) { cursor = 0; return expand(output.CleanExecutionOutputPanel({ output: value })) },
  }
}
const elements = (tree, type) => findElements(tree, (element) => element.type === type)
const group = (tree, kind, count) => elements(tree, 'section').find((section) => renderedText(section).includes(t(`clean.result.${kind}Records`, { count })))
const metric = (tree, key) => elements(tree, 'div').find((element) => element.props.className === 'iqon-row p-4' && renderedText(element).includes(t(key)))
const title = (tree) => elements(tree, 'CardTitle').find((element) => element.props.className === 'text-3xl')

test('a partial run separates tracked bytes, actual freed bytes, Mole totals and operation counts', () => {
  const tree = fixture().render()
  assert.equal(renderedText(title(tree)), t('clean.result.partialTitle'))
  assert.match(renderedText(metric(tree, 'clean.result.processedSize')), /10640781476 B/)
  assert.match(renderedText(metric(tree, 'clean.result.freedSize')), new RegExp(t('clean.result.notReported')))
  assert.match(renderedText(metric(tree, 'clean.result.moleItems')), /511/)
  assert.match(renderedText(metric(tree, 'clean.result.logItems')), /946/)
  assert.doesNotMatch(renderedText(tree), new RegExp(t('clean.completedCategoriesLabel')))
  assert.equal(findElements(tree, (element) => renderedText(element) === t('clean.cleanableNoSize')).length, 0)
  const statusCard = elements(tree, 'Card')[0]
  assert.match(statusCard.props.className, /yellow/)
})

test('failed operations are initially visible while confirmed and skipped entries remain collapsed', () => {
  const tree = fixture().render()
  assert.equal(elements(group(tree, 'failed', 4), 'li').length, 4)
  assert.match(renderedText(group(tree, 'failed', 4)), /failure-0 \(removal timed out\)/)
  assert.equal(elements(group(tree, 'confirmed', 946), 'li').length, 0)
  assert.equal(elements(group(tree, 'skipped', 173), 'li').length, 0)
  assert.doesNotMatch(renderedText(group(tree, 'confirmed', 946)), /log-0/)
})

test('confirmed records expand and paginate without attributing the group count to the first batch path', () => {
  const f = fixture()
  let tree = f.render()
  elements(group(tree, 'confirmed', 946), 'button')[0].props.onClick()
  tree = f.render()
  let confirmed = group(tree, 'confirmed', 946)
  assert.equal(elements(confirmed, 'li').length, 40)
  assert.match(renderedText(elements(confirmed, 'li')[0]), /log-0 \(batch\)/)
  assert.doesNotMatch(renderedText(elements(confirmed, 'li')[0]), /946/)
  assert.equal(elements(confirmed, 'Button')[0].props.disabled, true)
  elements(confirmed, 'Button')[1].props.onClick()
  tree = f.render(); confirmed = group(tree, 'confirmed', 946)
  assert.equal(elements(confirmed, 'li').length, 40)
  assert.match(renderedText(elements(confirmed, 'li')[0]), /log-40 /)
  assert.equal(elements(confirmed, 'Button')[0].props.disabled, false)
  elements(confirmed, 'button')[0].props.onClick()
  assert.equal(elements(group(f.render(), 'confirmed', 946), 'li').length, 0)
})

test('stdout keeps its summary and early diagnostics instead of using the live-operation tail', () => {
  const tree = fixture().render()
  const diagnostic = renderedText(elements(tree, 'pre')[0])
  assert.match(diagnostic, /Initial diagnostic kept/)
  assert.match(diagnostic, /Tracked cleanup: 9.91GB/)
  assert.doesNotMatch(diagnostic, /fixture\/log-|Only a late live-output/)
})

test('long diagnostic output is explicitly bounded while preserving its beginning and end', () => {
  const f = fixture()
  const output = ['diagnostic start', ...Array.from({ length: 900 }, (_, i) => `line-${i}`), 'final summary'].join('\n')
  const tree = f.output(output)
  const diagnostic = renderedText(elements(tree, 'pre')[0])
  assert.match(renderedText(tree), new RegExp(t('clean.result.outputTruncated', { count: 600 })))
  assert.match(diagnostic, /^diagnostic start/)
  assert.match(diagnostic, /final summary$/)
  assert.ok(diagnostic.split('\n').length <= 601)
  assert.doesNotMatch(diagnostic, /line-450\n/)
  elements(tree, 'Button')[0].props.onClick()
  assert.equal(elements(f.output(output), 'pre').length, 0)
})

test('a footer-only size discloses unspecified completeness and lower bounds retain their qualification', () => {
  const unspecified = fixture().render({ ...baseProps, summary: { ...summary, processedSizeKind: 'unspecified' } })
  assert.match(renderedText(metric(unspecified, 'clean.result.processedSize')), new RegExp(t('clean.result.processedUnspecified')))
  const lowerBound = fixture().render({ ...baseProps, summary: { ...summary, processedSizeKind: 'at_least' } })
  assert.match(renderedText(metric(lowerBound, 'clean.result.processedSize')), new RegExp(t('clean.result.processedAtLeast', { size: '10640781476 B' })))
  const partial = fixture().render({ ...baseProps, summary: { ...summary, processedSize: null, processedSizeKind: 'partial' } })
  assert.match(renderedText(metric(partial, 'clean.result.processedSize')), new RegExp(t('clean.result.processedPartial')))
})

test('a run with only failed operations is not presented as a completed cleanup', () => {
  const onlyFailures = records.filter((record) => record.action === 'FAILED')
  const tree = fixture({ parsedRecords: onlyFailures }).render({
    ...baseProps, status: 'failed', summary: { ...summary, itemCount: null, processedSize: null, operationCount: 0 },
  })
  assert.equal(renderedText(title(tree)), t('clean.result.failedTitle'))
  assert.match(elements(tree, 'Card')[0].props.className, /yellow/)
  assert.equal(elements(tree, 'li').length, 4)
})

test('skipped records alone do not turn a successful run into a failure', () => {
  const tree = fixture({ parsedRecords: records.filter((record) => record.action !== 'FAILED') }).render({
    ...baseProps, status: 'completed', summary: { ...summary, failedCount: 0 },
  })
  assert.equal(renderedText(title(tree)), t('clean.completedTitle'))
  assert.match(elements(tree, 'Card')[0].props.className, /green/)
})

test('cancellation remains distinct from partial completion and keeps failed records visible', () => {
  const tree = fixture().render({ ...baseProps, status: 'cancelled' })
  assert.equal(renderedText(title(tree)), t('clean.cancelledTitle'))
  assert.equal(elements(group(tree, 'failed', 4), 'li').length, 4)
  assert.doesNotMatch(renderedText(tree), /\{(?:size|count)\}/)
})

test('missing or ambiguous ledgers are not displayed as confirmed zero operations', () => {
  for (const status of ['unavailable', 'ambiguous']) {
    const tree = fixture({ parsedRecords: [] }).render({ ...baseProps, status: 'completed', summary: {
      ...summary, failedCount: 0, operationCount: 0, operationLogStatus: status,
    } })
    assert.match(renderedText(metric(tree, 'clean.result.logItems')), new RegExp(t(status === 'ambiguous' ? 'clean.result.ambiguous' : 'clean.result.notReported')))
    assert.match(renderedText(tree), new RegExp(t(status === 'ambiguous' ? 'clean.result.logAmbiguous' : 'clean.result.logUnavailable')))
  }
})

test('an ambiguous partial result warns about log attribution without inventing failed operations', () => {
  const tree = fixture({ parsedRecords: [] }).render({ ...baseProps, status: 'partial', summary: {
    ...summary, failedCount: 0, operationCount: 0, operationLogStatus: 'ambiguous',
  } })
  assert.match(elements(tree, 'Card')[0].props.className, /yellow/)
  assert.equal(renderedText(title(tree)), t('clean.result.partialTitle'))
  assert.ok(renderedText(tree).includes(t('clean.result.logAmbiguous')))
  assert.ok(!renderedText(tree).includes(t('clean.result.partialDesc', { count: 0 })))
})

test('legacy panel callers derive execution evidence instead of displaying preview estimates', () => {
  const tree = fixture().render({ ...baseProps, summary: undefined, preview: { potential_space: 999_999_999, item_count: 999, category_count: 9 } })
  assert.match(renderedText(metric(tree, 'clean.result.moleItems')), /511/)
  assert.doesNotMatch(renderedText(tree), /999999999 B/)
})
