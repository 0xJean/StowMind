import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './ios-organizer-test-harness.mjs'

const { summarizeAgentSizes, agentSizeLabel, agentItemSizeLabel } = loadTypeScript('../src/pages/agent-cleanup/sizeSummary.ts', {
  '@/lib/utils': { formatFileSize: (bytes) => `${bytes} B` },
})
const en = loadTypeScript('../src/i18n/en.ts', {}).en
const t = (key, vars = {}) => en[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name]))
const complete = (size) => ({ size, size_status: 'complete' })
const partial = (size) => ({ size, size_status: 'partial' })
const unavailable = (size = 0) => ({ size, size_status: 'unavailable' })

for (const [name, items, bytes, status] of [
  ['complete items retain an exact sum', [complete(128), complete(256)], 384, 'complete'],
  ['legacy valid measurements retain existing display semantics', [{ size: 128 }], 128, 'complete'],
  ['partial items contribute their known lower bound', [complete(128), partial(256)], 384, 'partial'],
  ['an unavailable item does not discard a measured subset', [complete(128), unavailable()], 128, 'partial'],
  ['stale bytes on unavailable items are not trusted', [complete(128), unavailable(9999)], 128, 'partial'],
  ['partial zero is unknown', [partial(0)], null, 'unavailable'],
  ['unavailable zero is unknown', [unavailable()], null, 'unavailable'],
  ['known zero plus unknown is not an exact zero', [complete(0), unavailable()], null, 'unavailable'],
  ['explicitly measured zero remains exact', [complete(0)], 0, 'complete'],
  ['empty selection has an exact zero', [], 0, 'complete'],
  ['invalid sizes do not poison a valid lower bound', [complete(128), complete(NaN), complete(-1), partial(Infinity)], 128, 'partial'],
  ['invalid measurements alone remain unknown', [complete(NaN), complete(-1)], null, 'unavailable'],
  ['unrecognized future statuses cannot assert an exact size', [complete(128), { size: 256, size_status: 'future_status' }], 128, 'partial'],
  ['overflow preserves only a safe known lower bound', [complete(Number.MAX_SAFE_INTEGER), complete(1)], Number.MAX_SAFE_INTEGER, 'partial'],
]) {
  test(name, () => {
    const result = summarizeAgentSizes(items)
    assert.equal(result.bytes, bytes)
    assert.equal(result.status, status)
    const expected = bytes === null ? t('clean.summary.unknown') : status === 'partial'
      ? t('clean.summary.atLeast', { size: `${bytes} B` }) : `${bytes} B`
    assert.equal(agentSizeLabel(result, t), expected)
    if (items.length === 1) assert.equal(agentItemSizeLabel(items[0], t), expected)
  })
}
