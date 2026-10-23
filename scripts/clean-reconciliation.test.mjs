import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './ios-organizer-test-harness.mjs'

const { reconcileCleanExecution } = loadTypeScript('../src/lib/stowmind-supplements/reconciliation.ts', {})
const before = { potential_space: 1_000, item_count: 100, summary_status: 'exact', scan_status: 'complete' }
const after = { ...before, potential_space: 100, item_count: 10 }

test('complete exact scans yield a labeled estimate, preserving genuine zero', () => {
  const result = reconcileCleanExecution(before, { ...after, potential_space: 0, item_count: 0 })
  assert.equal(result.source, 'stowmind_supplement')
  assert.equal(result.confidence, 'estimated')
  assert.equal(result.estimatedFreedBytes, 1_000)
  assert.equal(result.resolvedItemCount, 100)
})

for (const patch of [
  { summary_status: 'at_least' },
  { summary_status: 'unavailable' },
  { scan_status: 'incomplete' },
  { scan_status: 'unknown' },
  { summary_status: undefined, scan_status: undefined },
]) {
  test(`does not subtract uncertain observations: ${JSON.stringify(patch)}`, () => {
    for (const [left, right] of [[{ ...before, ...patch }, after], [before, { ...after, ...patch }]]) {
      const result = reconcileCleanExecution(left, right)
      assert.equal(result.confidence, 'unknown')
      assert.equal(result.estimatedFreedBytes, null)
      assert.equal(result.resolvedItemCount, null)
    }
  })
}

for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
  test(`unknown or invalid capacity is never coerced into zero: ${value}`, () => {
    const result = reconcileCleanExecution(before, { ...after, potential_space: value })
    assert.equal(result.afterPotentialBytes, null)
    assert.equal(result.estimatedFreedBytes, null)
    assert.equal(result.confidence, 'unknown')
  })
}

test('missing observations require another scan', () => {
  assert.equal(reconcileCleanExecution(null, after), null)
  assert.equal(reconcileCleanExecution(before, undefined), null)
})
