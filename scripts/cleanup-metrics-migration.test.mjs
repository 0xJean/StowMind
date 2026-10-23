import assert from 'node:assert/strict'
import test from 'node:test'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { loadTypeScript } from './ios-organizer-test-harness.mjs'

const migration = loadTypeScript('../src/stores/cleanupMetricsMigration.ts', {})
const activity = loadTypeScript('../src/lib/stowmind-supplements/cleanupActivity.ts', {})
const utils = { formatFileSize: (value) => `${value} B` }
const labels = loadTypeScript('../src/pages/history/cleanupLabels.ts', { '@/lib/utils': utils })
const processed = loadTypeScript('../src/pages/statistics/processedSize.ts', { '@/lib/utils': utils })
const { en } = loadTypeScript('../src/i18n/en.ts', {})
const t = (key, vars = {}) => en[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name]))
const copy = (value) => JSON.parse(JSON.stringify(value))
const record = (id, type, size, summary = {}, extra = {}) => ({
  id, type, timestamp: '2026-01-01T00:00:00Z', directory: '/fixture', totalFiles: 2,
  categories: { fixture: 2 }, moves: [], executed: true,
  cleanupSummary: { action: 'execute', itemCount: 2, totalSize: size, sizeKind: 'reported_freed', outcome: 'success', ...summary },
  ...extra,
})

function legacyState() {
  return {
    aiProvider: { type: 'openai', host: 'https://fixture.invalid', model: 'fixture-model', apiKey: 'fixture-key' },
    aiOnlyHardCases: false, scanRecursive: true, excludePatterns: ['fixture-ignore'],
    backupBeforeOrganize: true, backupDirectory: '/fixture/backup',
    watchFolderEnabled: true, watchFolderPathsText: '/fixture/watch',
    categories: [{ name: 'Fixture category', icon: '📁', extensions: ['.fixture'], keywords: [] }],
    lastOrganizeRecordId: 'organize',
    history: [
      record('installer', 'installer', 4_000),
      record('uninstall', 'uninstall', 5_000),
      record('clean', 'clean', 100),
      record('purge', 'purge', 25, { outcome: 'partial' }),
      record('unknown', 'clean', 1_000, { sizeKind: 'unknown' }),
      record('estimated', 'purge', 2_000, { sizeKind: 'estimated' }),
      record('processed', 'agent-cleanup', 3_000, { sizeKind: 'processed' }),
      record('organize', 'organize', undefined),
    ],
    statistics: {
      totalFilesOrganized: 41, totalSizeOrganized: 1234, categoryCounts: { fixture: 41 },
      cleanItemsRemoved: 800, cleanOperationCount: 35, lastCleaned: '2026-01-01T00:00:00Z',
      cleanSizeFreed: 90_000, reportedFreedBytes: 60_000,
      agentCleanupItemsRemoved: 31, agentCleanupOperationCount: 3, agentCleanupProcessedBytes: 500,
      systemCacheObservedBytes: 700, systemCacheCleanupCount: 2,
    },
    customFutureSetting: { retained: true },
  }
}

test('version zero relabels only the affected engines and rebuilds counters from verifiable retained history', () => {
  const before = legacyState()
  const original = structuredClone(before)
  const after = migration.migrateCleanupMetrics(before, 0)
  assert.deepEqual(before, original, 'migration must not mutate the saved input')
  assert.equal(after.history.length, before.history.length)
  assert.equal(after.history[0].cleanupSummary.sizeKind, 'processed')
  assert.equal(after.history[1].cleanupSummary.sizeKind, 'processed')
  assert.equal(after.history[0].cleanupSummary.totalSize, 4000)
  assert.equal(after.history[1].cleanupSummary.totalSize, 5000)
  assert.equal(after.history[4].cleanupSummary.sizeKind, 'unknown')
  assert.equal(after.history[5].cleanupSummary.sizeKind, 'estimated')
  assert.equal(after.statistics.reportedFreedBytes, 125)
  assert.equal(after.statistics.cleanSizeFreed, 125)
  assert.equal(after.statistics.legacyUnverifiedFreedBytes, 90_000)
  const { reportedFreedBytes, cleanSizeFreed, legacyUnverifiedFreedBytes, ...remainingStatistics } = after.statistics
  const { reportedFreedBytes: oldReported, cleanSizeFreed: oldSize, ...oldStatistics } = before.statistics
  assert.deepEqual(copy(remainingStatistics), oldStatistics)
  for (const key of Object.keys(before).filter((key) => key !== 'history' && key !== 'statistics')) {
    assert.deepEqual(copy(after[key]), before[key])
  }
  assert.equal(activity.buildCleanupActivitySummary(after.history, after.statistics).totalFreed, 125)
  assert.equal(activity.cleanupProcessedSize(after.history[0]), 4000)
  assert.equal(activity.cleanupProcessedSize(after.history[1]), 5000)
})

test('unknown or missing size provenance is never upgraded during migration', () => {
  const records = [undefined, 'unknown', 'estimated', 'processed'].map((sizeKind, i) => record(`unknown-${i}`, 'uninstall', 100, { sizeKind }))
  const after = migration.migrateCleanupMetrics({ history: records, statistics: { reportedFreedBytes: 400 } }, 0)
  assert.deepEqual(copy(after.history), copy(records))
  assert.equal(after.statistics.reportedFreedBytes, 0)
})

test('preview, undone, failed, skipped and unattributed records do not authorize released-space totals', () => {
  const history = [
    record('preview', 'clean', 1000, { action: 'preview' }),
    record('not-executed', 'clean', 1000, {}, { executed: false }),
    record('undone', 'clean', 1000, {}, { undone: true }),
    record('failed', 'clean', 1000, { outcome: 'failed' }),
    record('unknown', 'clean', 1000, { outcome: 'unknown' }),
    record('skipped', 'clean', 1000, { outcome: 'skipped' }),
    record('missing-outcome', 'clean', 1000, { outcome: undefined }),
    record('missing-action', 'clean', 1000, { action: undefined }),
    record('system', 'system-cache', 1000), record('agent', 'agent-cleanup', 1000),
    record('no-type', undefined, 1000), record('valid-zero', 'clean', 0),
  ]
  const after = migration.migrateCleanupMetrics({ history, statistics: { reportedFreedBytes: 12345 } }, 0)
  assert.equal(after.statistics.reportedFreedBytes, 0)
  assert.equal(after.history.length, history.length)
  assert.equal(after.statistics.legacyUnverifiedFreedBytes, 12345)
  assert.equal(activity.buildCleanupActivitySummary(after.history, after.statistics).totalFreed, 0)
})

test('cropped or absent history cannot preserve an unverifiable lifetime released-space counter', () => {
  for (const history of [[], undefined, null]) {
    const after = migration.migrateCleanupMetrics({ history, statistics: { cleanSizeFreed: 99, reportedFreedBytes: 98, cleanOperationCount: 5 } }, 0)
    assert.equal(after.statistics.reportedFreedBytes, 0)
    assert.equal(after.statistics.cleanSizeFreed, 0)
    assert.equal(after.statistics.cleanOperationCount, 5)
    assert.equal(after.statistics.legacyUnverifiedFreedBytes, 99)
  }
})

test('invalid byte values and overflowing sums cannot produce trusted space totals', () => {
  for (const size of [NaN, Infinity, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    const after = migration.migrateCleanupMetrics({ history: [record('bad', 'clean', size)], statistics: {} }, 0)
    assert.equal(after.statistics.reportedFreedBytes, 0)
  }
  const overflow = migration.migrateCleanupMetrics({ history: [record('a', 'clean', Number.MAX_SAFE_INTEGER), record('b', 'clean', 1)] }, 0)
  assert.equal(overflow.statistics.reportedFreedBytes, 0)
  assert.equal(activity.buildCleanupActivitySummary(overflow.history, overflow.statistics).totalFreed, 0)
  for (const value of [null, undefined, 'invalid', []]) assert.deepEqual(copy(migration.migrateCleanupMetrics(value, 0)), {})
})

test('already-migrated and future versions retain post-migration lifetime totals unchanged', () => {
  const state = { history: [], statistics: { reportedFreedBytes: 7_000, cleanSizeFreed: 7_000, legacyUnverifiedFreedBytes: 9_000 } }
  assert.equal(migration.migrateCleanupMetrics(state, 1), state)
  assert.equal(migration.migrateCleanupMetrics(state, 2), state)
  const initial = migration.migrateCleanupMetrics(legacyState(), 0)
  assert.equal(migration.migrateCleanupMetrics(initial, 1), initial)
})

test('legacy processing amounts keep their value but disclose unreported measurement completeness in history and statistics', () => {
  const history = [
    record('agent', 'agent-cleanup', 10, { sizeKind: 'processed' }),
    record('installer', 'installer', 20), record('uninstall', 'uninstall', 30),
  ]
  const state = { history, statistics: { reportedFreedBytes: 60 } }
  const after = migration.migrateCleanupMetrics(state, 0)
  let total
  for (let index = 0; index < after.history.length; index += 1) {
    const entry = after.history[index]
    assert.equal(entry.cleanupSummary.totalSize, history[index].cleanupSummary.totalSize)
    assert.equal(entry.cleanupSummary.sizeKind, 'processed')
    assert.equal(entry.cleanupSummary.processedSizeKind, 'unspecified')
    assert.equal(labels.cleanupHistorySizeLabel(entry, t), t('history.spaceProcessedUnspecified', { size: `${entry.cleanupSummary.totalSize} B` }))
    total = processed.addProcessedSize(total, entry)
  }
  assert.equal(total.bytes, 60)
  assert.equal(total.unspecified, true)
  assert.equal(processed.processedSizeTotalLabel(total, t), t('history.spaceProcessedUnspecified', { size: '60 B' }))
  assert.equal(activity.buildCleanupActivitySummary(after.history, after.statistics).totalFreed, 0)
  const alreadyMigrated = migration.migrateCleanupMetrics(state, 1)
  assert.equal(alreadyMigrated, state)
  assert.equal(alreadyMigrated.history[0].cleanupSummary.processedSizeKind, undefined)
})

test('migration preserves explicit legacy lower bounds and unavailable precision instead of claiming completeness', () => {
  for (const kind of ['reported', 'at_least', 'partial', 'unspecified', 'unavailable']) {
    const state = { history: [
      record('agent', 'agent-cleanup', 10, { sizeKind: 'processed', processedSizeKind: kind }),
      record('installer', 'installer', 20, { processedSizeKind: kind }),
      record('uninstall', 'uninstall', 30, { processedSizeKind: kind }),
    ] }
    const after = migration.migrateCleanupMetrics(state, 0)
    assert.deepEqual(Array.from(after.history, (entry) => entry.cleanupSummary.processedSizeKind), [kind, kind, kind])
  }
})

// Hydrate the actual application store through the real Zustand middleware.
// Only its storage adapter is replaced with an isolated in-memory map.
function hydrate(envelope, key = 'stowmind') {
  const values = new Map(envelope ? [[key, JSON.stringify(envelope)]] : [])
  const storage = {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, value),
    removeItem: (name) => values.delete(name),
  }
  let config
  const app = loadTypeScript('../src/stores/app.ts', {
    zustand: { create },
    'zustand/middleware': { persist(initializer, options) {
      config = options
      return persist(initializer, { ...options, storage: createJSONStorage(() => storage) })
    } },
    './cleanupMetricsMigration': migration,
  }, { window: {}, localStorage: storage })
  return { store: app.useAppStore, config, values }
}

test('real persist configuration upgrades legacy version zero once and keeps settings and action methods', () => {
  const { store, config, values } = hydrate({ state: legacyState(), version: 0 })
  assert.equal(config.name, 'stowmind')
  assert.equal(config.version, 1)
  assert.equal(typeof config.migrate, 'function')
  assert.equal(store.persist.hasHydrated(), true)
  const state = store.getState()
  assert.equal(state.statistics.reportedFreedBytes, 125)
  assert.equal(state.statistics.legacyUnverifiedFreedBytes, 90_000)
  assert.equal(state.aiProvider.model, 'fixture-model')
  assert.equal(state.aiProvider.apiKey, 'fixture-key')
  assert.equal(state.scanRecursive, true)
  assert.equal(state.backupBeforeOrganize, true)
  assert.equal(state.watchFolderEnabled, true)
  assert.equal(typeof state.updateStatistics, 'function')
  assert.equal(typeof state.addHistory, 'function')
  const saved = JSON.parse(values.get('stowmind'))
  assert.equal(saved.version, 1)
  assert.equal(saved.state.history[0].cleanupSummary.sizeKind, 'processed')
  assert.equal(saved.state.statistics.reportedFreedBytes, 125)
})

test('real version one rehydration preserves later totals after the validating history is cropped', () => {
  const first = hydrate({ state: legacyState(), version: 0 })
  first.store.getState().updateStatistics({ reportedFreedBytes: 7_000, cleanSizeFreed: 7_000 })
  first.store.getState().clearHistory()
  const next = hydrate(JSON.parse(first.values.get('stowmind')))
  assert.equal(next.store.getState().history.length, 0)
  assert.equal(next.store.getState().statistics.reportedFreedBytes, 7_000)
  assert.equal(next.store.getState().statistics.cleanSizeFreed, 7_000)
  assert.equal(next.store.getState().statistics.legacyUnverifiedFreedBytes, 90_000)
})

test('old organizer storage key is carried forward before the same safe versioned migration', () => {
  const { store, values } = hydrate({ state: legacyState(), version: 0 }, 'ai-file-organizer')
  assert.equal(values.has('ai-file-organizer'), false)
  assert.equal(JSON.parse(values.get('stowmind')).version, 1)
  assert.equal(store.getState().statistics.reportedFreedBytes, 125)
  assert.equal(store.getState().lastOrganizeRecordId, 'organize')
})

test('a fresh store keeps normal defaults and does not invent a legacy diagnostic counter', () => {
  const { store } = hydrate()
  assert.equal(store.getState().aiProvider.type, 'ollama')
  assert.equal(store.getState().statistics.reportedFreedBytes, 0)
  assert.equal(store.getState().statistics.legacyUnverifiedFreedBytes, undefined)
  assert.equal(store.getState().history.length, 0)
})
