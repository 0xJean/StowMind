import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'
import { button, createPage, settle, t } from './agent-cleanup-test-harness.mjs'

const executionSize = loadTypeScript('../src/pages/agent-cleanup/executionSize.ts', {
  '@/lib/utils': { formatFileSize: (value) => `${value} bytes` },
})
const labels = loadTypeScript('../src/pages/history/cleanupLabels.ts', {
  '@/lib/utils': { formatFileSize: (value) => `${value} bytes` },
})
const activity = loadTypeScript('../src/lib/stowmind-supplements/cleanupActivity.ts', {})
const outcome = (patch) => ({
  removed_count: 1, freed_bytes: null, skipped_count: 0, errors: [], completed_at: '1700000010',
  actions: [{ path: '/tmp/agent-a', success: true, size_bytes: null, message: 'Fixture processed' }], ...patch,
})

for (const [name, patch, bytes, kind] of [
  ['complete positive measurement', { processed_bytes: 384, processed_size_status: 'complete' }, 384, 'reported'],
  ['known lower bound', { processed_bytes: 384, processed_size_status: 'partial' }, 384, 'at_least'],
  ['partial zero is unknown', { processed_bytes: 0, processed_size_status: 'partial' }, null, 'unavailable'],
  ['complete zero is known', { processed_bytes: 0, processed_size_status: 'complete' }, 0, 'reported'],
  ['unavailable ignores stale bytes', { processed_bytes: 384, processed_size_status: 'unavailable' }, null, 'unavailable'],
  ['unavailable null', { processed_bytes: null, processed_size_status: 'unavailable' }, null, 'unavailable'],
  ['legacy processed value has unspecified completeness', { processed_bytes: 384 }, 384, 'unspecified'],
  ['legacy misleading freed name is only a processing amount', { freed_bytes: 384 }, 384, 'unspecified'],
  ['legacy zero is qualified', { processed_bytes: 0 }, 0, 'unspecified'],
  ['explicit unknown does not reuse legacy fallback', { processed_bytes: null, freed_bytes: 999 }, null, 'unavailable'],
  ['invalid finite measurement is unknown', { processed_bytes: -1, processed_size_status: 'complete' }, null, 'unavailable'],
  ['unsafe measurement is unknown', { processed_bytes: Number.MAX_SAFE_INTEGER + 1, processed_size_status: 'complete' }, null, 'unavailable'],
]) {
  test(`Agent execution keeps ${name} consistent across helper, toast, result and history`, async () => {
    const result = outcome(patch)
    const measured = executionSize.summarizeAgentExecutionSize(result)
    assert.equal(measured.bytes, bytes)
    assert.equal(measured.kind, kind)
    const size = bytes === null ? t('clean.summary.unknown') : kind === 'at_least'
      ? t('clean.summary.atLeast', { size: `${bytes} bytes` }) : kind === 'unspecified'
        ? t('agentCleanup.sizeUnspecified', { size: `${bytes} bytes` }) : `${bytes} bytes`
    assert.equal(executionSize.agentExecutionSizeLabel(measured, t), size)
    const page = createPage((command, _args, fallback) => command === 'agent_cleanup_execute' ? result : fallback())
    page.render(); await settle()
    button(page.render(), t('agentCleanup.cleanSelected')).props.onClick()
    await settle()
    const tree = page.render()
    assert.ok(renderedText(tree).includes(t('agentCleanup.resultSummary', { count: 1, size })))
    assert.ok(page.notices.some((notice) => notice.message === t('agentCleanup.cleanSuccess', { count: 1, size })))
    const record = page.history.find((entry) => entry.type === 'agent-cleanup')
    assert.equal(record.cleanupSummary.totalSize, bytes ?? undefined)
    assert.equal(record.cleanupSummary.processedSize, bytes ?? undefined)
    assert.equal(record.cleanupSummary.processedSizeKind, kind)
    assert.equal(record.cleanupSummary.sizeKind, bytes === null ? 'unknown' : 'processed')
    assert.equal(page.store.statistics.agentCleanupProcessedBytes, bytes ?? 0)
    assert.equal(page.store.statistics.reportedFreedBytes ?? 0, 0)
    assert.equal(page.store.statistics.cleanSizeFreed ?? 0, 0)
    assert.equal(activity.cleanupFreedSize(record), 0)
    const historyLabel = labels.cleanupHistorySizeLabel(record, t)
    if (kind === 'at_least') assert.ok(historyLabel.includes(t('history.spaceProcessedAtLeast', { size: `${bytes} bytes` })))
    if (kind === 'unspecified') assert.ok(historyLabel.includes(t('history.spaceProcessedUnspecified', { size: `${bytes} bytes` })))
    if (kind === 'unavailable') assert.equal(historyLabel, t('history.spaceUnknown'))
  })
}
