import assert from 'node:assert/strict'
import test from 'node:test'
import { jsx, loadTypeScript, renderedText } from './ios-organizer-test-harness.mjs'

const failures = loadTypeScript('../src/lib/maintenanceRun.ts', {})
const settle = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Execute the real hook with controllable IPC, effects, and keep-alive routing.
function fixture(invoke) {
  const slots = [], effects = [], calls = [], updates = []
  let cursor = 0, pathname = '/optimize'
  const changed = (old, deps) => !old || deps.some((value, index) => value !== old.deps[index])
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => {
        updates.push(index)
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
      }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useCallback(callback, deps) {
      const index = cursor++
      if (changed(slots[index], deps)) slots[index] = { deps, callback }
      return slots[index].callback
    },
    useEffect(effect, deps) {
      const index = cursor++, old = slots[index]
      if (changed(old, deps)) effects.push(() => {
        old?.cleanup?.()
        slots[index] = { deps, effect, cleanup: effect() }
      })
    },
  }
  const { useMaintenanceRun } = loadTypeScript('../src/hooks/useMaintenanceRun.ts', {
    react, 'react-router-dom': { useLocation: () => ({ pathname }) },
    '@/lib/maintenanceRun': failures,
    '@tauri-apps/api/tauri': { invoke: async (command, args) => {
      calls.push({ command, args })
      return invoke(command, args)
    } },
  })
  return {
    calls, updates,
    render(path = pathname) {
      pathname = path; cursor = 0
      const value = useMaintenanceRun('/optimize')
      effects.splice(0).forEach((effect) => effect())
      return value
    },
    unmount() { slots.filter((slot) => slot?.effect).forEach((slot) => slot.cleanup?.()) },
  }
}

test('a run binds its own ID, rejects immediate duplicate entry, and releases after completion', async () => {
  const operation = deferred()
  const f = fixture(() => operation.promise)
  const first = f.render().runTask('preview', 'mole_optimize_health_json', { scope: 'all', runId: 'untrusted-id' })
  const running = f.render()
  assert.equal(running.busy, true)
  assert.equal(f.calls[0].args.runId, running.run.id)
  assert.notEqual(running.run.id, 'untrusted-id')
  assert.equal(f.calls[0].args.scope, 'all')
  assert.equal(await running.runTask('execute', 'mole_optimize_execute'), null)
  assert.equal(f.calls.length, 1)
  operation.resolve({ raw_output: 'preview complete' })
  const result = await first
  assert.equal(result.ok, true)
  assert.equal(result.interrupted, false)
  assert.equal(f.render().busy, false)
  assert.equal(f.render().output, 'preview complete')
})

test('cancel acknowledgement alone cannot unlock a pending native operation', async () => {
  const operation = deferred(), cancellation = deferred()
  const f = fixture((command) => command === 'maintenance_cancel' ? cancellation.promise : operation.promise)
  const first = f.render().runTask('execute', 'mole_optimize_execute')
  const id = f.render().run.id
  const cancelling = f.render().cancel()
  assert.equal(f.calls[1].command, 'maintenance_cancel')
  assert.equal(f.calls[1].args.runId, id)
  cancellation.resolve()
  await cancelling
  assert.equal(f.render().busy, true)
  assert.equal(await f.render().runTask('execute', 'mole_optimize_execute'), null)
  operation.reject({ code: 'cancelled', message: 'cancelled after registration', raw_output: 'tail', output_truncated: false })
  const result = await first
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'cancelled')
  assert.equal(f.render().busy, false)
})

test('native completion cannot unlock a cancellation RPC that has not confirmed termination', async () => {
  const operation = deferred(), cancellation = deferred()
  const f = fixture((command) => command === 'maintenance_cancel' ? cancellation.promise : operation.promise)
  const first = f.render().runTask('execute', 'mole_optimize_execute')
  const cancelling = f.render().cancel()
  let returned = false
  first.then(() => { returned = true })
  operation.resolve({ applied_count: 1, summary_status: 'complete', raw_output: 'Applied 1' })
  await settle()
  assert.equal(returned, false)
  assert.equal(f.render().busy, true)
  assert.equal(await f.render().runTask('execute', 'mole_optimize_execute'), null)
  cancellation.resolve()
  await cancelling
  const result = await first
  assert.equal(result.interrupted, true, 'exit(0) following a cancellation is uncertain')
  assert.equal(f.render().failure.code, 'cancelled')
  assert.equal(f.render().busy, false)
})

test('a failed cancellation keeps ownership and permits retry without issuing another operation', async () => {
  const operation = deferred(), retry = deferred()
  let attempts = 0
  const f = fixture((command) => {
    if (command !== 'maintenance_cancel') return operation.promise
    return ++attempts === 1 ? Promise.reject({ code: 'failed', message: 'termination not confirmed' }) : retry.promise
  })
  const first = f.render().runTask('execute', 'mole_optimize_execute')
  await f.render().cancel()
  assert.equal(f.render().cancelError, 'termination not confirmed')
  assert.equal(f.render().busy, true)
  assert.equal(f.render().cancelling, false)
  assert.equal(await f.render().runTask('execute', 'mole_optimize_execute'), null)
  const retrying = f.render().cancel()
  await f.render().cancel()
  assert.equal(attempts, 2, 'An in-flight cancellation is not duplicated')
  retry.resolve(); await retrying
  operation.resolve({ raw_output: 'cooperative exit 0' })
  assert.equal((await first).interrupted, true)
  assert.equal(f.calls.filter(({ command }) => command === 'mole_optimize_execute').length, 1)
  assert.equal(f.render().failure.code, 'cancelled')
})

test('leaving a keep-alive route cancels once and cannot authorize hidden or replacement work', async () => {
  const operation = deferred(), cancellation = deferred()
  const f = fixture((command) => command === 'maintenance_cancel' ? cancellation.promise : operation.promise)
  const first = f.render().runTask('execute', 'mole_optimize_execute')
  const id = f.render().run.id
  f.render('/history')
  assert.equal(f.calls[1].args.runId, id)
  assert.equal(f.render('/history').isVisible(), false)
  assert.equal(await f.render().runTask('scan', 'mole_optimize_health_json'), null)
  f.render('/optimize')
  assert.equal(f.render().busy, true)
  assert.equal(await f.render().runTask('execute', 'mole_optimize_execute'), null)
  assert.equal(f.calls.filter(({ command }) => command === 'maintenance_cancel').length, 1)
  cancellation.resolve()
  operation.reject({ code: 'cancelled', message: 'stopped' })
  await first
  assert.equal(f.render().busy, false)
  const next = await f.render().runTask('preview', 'mole_optimize_health_json')
  assert.equal(next.ok, false)
  assert.notEqual(f.calls.at(-1).args.runId, id, 'A later explicit retry receives a new native identity')
})

test('an inactive page and an unmounted callback cannot launch a new native command', async () => {
  const f = fixture(() => assert.fail('No native invocation expected'))
  const hidden = f.render('/history')
  assert.equal(await hidden.runTask('preview', 'mole_optimize_health_json'), null)
  const visible = f.render('/optimize')
  f.unmount()
  assert.equal(await visible.runTask('execute', 'mole_optimize_execute'), null)
  assert.equal(f.calls.length, 0)
})

test('real unmount requests cancellation and suppresses all late state updates', async () => {
  const operation = deferred(), cancellation = deferred()
  const f = fixture((command) => command === 'maintenance_cancel' ? cancellation.promise : operation.promise)
  const first = f.render().runTask('execute', 'mole_optimize_execute')
  f.unmount()
  const updateCount = f.updates.length
  assert.equal(f.calls.filter(({ command }) => command === 'maintenance_cancel').length, 1)
  cancellation.reject({ code: 'failed', message: 'late cancel failure' })
  operation.reject({ code: 'timeout', message: 'deadline', raw_output: 'partial diagnostic tail', output_truncated: true })
  const result = await first
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'timeout')
  assert.equal(f.updates.length, updateCount)
})

test('structured timeout and partial execution evidence survive IPC without becoming success', async () => {
  const partial = { applied_count: 2, summary_status: 'partial' }
  const native = { code: 'timeout', message: 'deadline exceeded', raw_output: 'final diagnostics', output_truncated: true, partial_result: partial }
  const f = fixture(() => Promise.reject(JSON.stringify(native)))
  const result = await f.render().runTask('execute', 'mole_optimize_execute')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'timeout')
  assert.equal(result.error.partial_result.applied_count, 2)
  assert.equal(f.render().failure.code, 'timeout')
  assert.equal(f.render().failure.output_truncated, true)
  assert.equal(f.render().output, native.raw_output)
  assert.equal(f.render().busy, false)
})

test('successful execution still labels retained logs as truncated and clears that flag for the next task', async () => {
  let calls = 0
  const f = fixture(() => Promise.resolve(++calls === 1
    ? { raw_output: 'confirmed summary tail', output_truncated: true }
    : { raw_output: 'complete diagnostic', output_truncated: false }))
  assert.equal((await f.render().runTask('execute', 'mole_optimize_execute')).ok, true)
  assert.equal(f.render().outputTruncated, true)
  assert.equal(f.render().output, 'confirmed summary tail')
  await f.render().runTask('preview', 'mole_optimize_health_json')
  assert.equal(f.render().outputTruncated, false)
})

test('an unconfirmed descendant cleanup keeps the lane after IPC failure until a successful cancel retry', async () => {
  const operation = deferred(), retry = deferred()
  let attempts = 0
  const f = fixture((command) => {
    if (command !== 'maintenance_cancel') return operation.promise
    return ++attempts === 1 ? Promise.reject({ code: 'failed', message: 'descendant still running', cleanup_pending: true }) : retry.promise
  })
  const first = f.render().runTask('execute', 'mole_optimize_execute')
  const id = f.render().run.id
  operation.reject({ code: 'failed', message: 'termination unconfirmed', cleanup_pending: true, raw_output: 'partial output' })
  const result = await first
  assert.equal(result.ok, false)
  assert.equal(result.error.cleanup_pending, true)
  assert.equal(f.render().busy, true, 'An IPC rejection is not proof that the process tree exited')
  assert.equal(await f.render().runTask('execute', 'mole_optimize_execute'), null)
  await f.render().cancel()
  assert.equal(f.render().cancelError, 'descendant still running')
  assert.equal(f.render().busy, true)
  const cancelling = f.render().cancel()
  assert.equal(f.calls.at(-1).args.runId, id)
  retry.resolve(); await cancelling
  assert.equal(f.render().busy, false)
  assert.equal(f.render().failure.code, 'failed', 'Confirming exit does not rewrite the action into success')
})

test('a late cleanup-pending error cannot reverse an earlier confirmed cancellation', async () => {
  const operation = deferred()
  const f = fixture((command) => command === 'maintenance_cancel' ? Promise.resolve() : operation.promise)
  const first = f.render().runTask('execute', 'mole_optimize_execute')
  await f.render().cancel()
  assert.equal(f.render().busy, true)
  operation.reject({ code: 'failed', message: 'earlier cleanup uncertainty', cleanup_pending: true })
  assert.equal((await first).ok, false)
  assert.equal(f.render().busy, false, 'The cancellation RPC already confirmed process-tree exit')
})

test('cancellation and timeout status render a warning and preserve bounded diagnostic output', () => {
  const { MaintenanceRunStatus } = loadTypeScript('../src/components/MaintenanceRunStatus.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/ui/button': { Button: 'Button' }, '@/i18n': { useI18n: () => ({ t: (key) => key }) },
    'lucide-react': { Loader2: 'Loader2', Square: 'Square' },
  })
  for (const code of ['cancelled', 'timeout']) {
    const tree = MaintenanceRunStatus({ state: {
      run: null, cancelling: false, cancelError: null, output: 'diagnostic tail',
      failure: { code, message: 'result uncertain', raw_output: 'diagnostic tail', output_truncated: true },
    }, onCancel() {} })
    const text = renderedText(tree)
    assert.ok(text.includes(`maintenance.${code}`))
    assert.ok(text.includes('maintenance.truncated'))
    assert.ok(text.includes('diagnostic tail'))
    assert.equal(text.includes('maintenance.running'), false)
  }
})
