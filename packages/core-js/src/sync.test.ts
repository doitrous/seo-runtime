import assert from 'node:assert/strict'
import test from 'node:test'
import { applySnapshot, HEALTH_INTERVAL_MS, PULL_INTERVAL_MS, sanitizeSnapshot, startSync } from './sync.ts'
import { healthPayload, MAX_REDIRECT_HITS } from './health.ts'
import { EMPTY_META, EMPTY_SETTINGS, type Snapshot } from './types.ts'
import { JsonFileStore } from './stores/json-file.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 2, siteSlug: 'x', settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://x.com' } },
  pages: [], redirects: [], ...over,
})

const tmpStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seo-runtime-'))
  const store = new JsonFileStore(join(dir, 'state.json'))
  return { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('a newer snapshot is applied', async () => {
  const { store, cleanup } = tmpStore()
  assert.deepEqual(await applySnapshot(store, snap()), { status: 'applied', version: 2 })
  assert.equal((await store.getSnapshot())!.version, 2)
  cleanup()
})

test('an older snapshot is ignored', async () => {
  const { store, cleanup } = tmpStore()
  await applySnapshot(store, snap({ version: 5 }))
  assert.deepEqual(await applySnapshot(store, snap({ version: 4 })), { status: 'stale', version: 5 })
  assert.equal((await store.getSnapshot())!.version, 5)
  cleanup()
})

test('the same version is re-applied, so a retry after a partial write is safe', async () => {
  const { store, cleanup } = tmpStore()
  await applySnapshot(store, snap({ version: 5 }))
  assert.equal((await applySnapshot(store, snap({ version: 5 }))).status, 'applied')
  cleanup()
})

test('a body that is not a snapshot is rejected', async () => {
  const { store, cleanup } = tmpStore()
  assert.equal((await applySnapshot(store, { nope: true })).status, 'invalid')
  assert.equal((await applySnapshot(store, null)).status, 'invalid')
  // Deep enough that sanitizeSnapshot cannot then dereference undefined: a malformed page or
  // redirect is a 400, never a 500.
  assert.equal((await applySnapshot(store, snap({ pages: [{ path: '/a' } as never] }))).status, 'invalid')
  assert.equal((await applySnapshot(store, snap({ redirects: [{ source: '/a' } as never] }))).status, 'invalid')
  assert.equal((await applySnapshot(store, { ...snap(), settings: null } as never)).status, 'invalid')
  cleanup()
})

test('a snapshot addressed to another site is refused', async () => {
  const { store, cleanup } = tmpStore()
  await applySnapshot(store, snap())
  assert.equal((await applySnapshot(store, snap({ version: 9, siteSlug: 'other' }))).status, 'invalid')
  assert.equal((await store.getSnapshot())!.siteSlug, 'x')
  cleanup()
})

test('a cold store refuses a snapshot for another site when a slug is configured', async () => {
  const { store, cleanup } = tmpStore()
  const cfg = { hubUrl: '', secret: '', slug: 'x' }
  const out = await applySnapshot(store, snap({ siteSlug: 'other' }), cfg)
  assert.equal(out.status, 'invalid')
  assert.equal(await store.getSnapshot(), null)
  // The matching slug still applies normally.
  assert.equal((await applySnapshot(store, snap({ siteSlug: 'x' }), cfg)).status, 'applied')
  cleanup()
})

test('startSync schedules a pull timer and a separate hourly health timer, and stop clears both', () => {
  const originalSet = global.setInterval
  const originalClear = global.clearInterval
  const scheduled: number[] = []
  const cleared: unknown[] = []
  // A stub rather than node:test's mock timers: this only needs to see what intervals were
  // requested and that stopping the returned function tears both of them down.
  global.setInterval = ((_fn: (...a: unknown[]) => void, ms?: number) => {
    scheduled.push(ms ?? -1)
    return { ref() { return this }, unref() { return this } } as unknown as NodeJS.Timeout
  }) as typeof setInterval
  global.clearInterval = ((t: unknown) => { cleared.push(t) }) as typeof clearInterval
  try {
    const store = { getSnapshot: async () => null } as never
    const stop = startSync(store, { version: '0.1.0' })
    assert.equal(scheduled.length, 2)
    assert.ok(scheduled.includes(PULL_INTERVAL_MS))
    assert.ok(scheduled.includes(HEALTH_INTERVAL_MS))
    stop()
    assert.equal(cleared.length, 2)
  } finally {
    global.setInterval = originalSet
    global.clearInterval = originalClear
  }
})

test('unsafe redirect destinations are dropped at sync time', () => {
  const s = sanitizeSnapshot(snap({ redirects: [
    { source: '/a', destination: 'http://evil.com', type: 301, active: true },
    { source: '/b', destination: '/ok', type: 301, active: true },
  ] }))
  assert.deepEqual(s.redirects.map((r) => r.source), ['/b'])
})

test('invalid JSON-LD overrides are dropped at sync time', () => {
  const page = {
    key: 'k', type: 'page', lang: 'en', path: '/en/a', group: 'k', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z',
    seo: { seoTitle: '', metaDescription: '', canonical: '', index: true, follow: true, includeInSitemap: true, priority: 0.5, og: EMPTY_META, twitter: EMPTY_META, schemaType: '', faq: [], structuredData: [{ '@type': 'Thing' }, { '@context': 'https://schema.org', '@type': 'Thing' }] },
  }
  const s = sanitizeSnapshot(snap({ pages: [page as never] }))
  assert.equal(s.pages[0].seo.structuredData.length, 1)
})

test('the health payload carries version, counts and the hit deltas, and does NOT reset them', async () => {
  const { store, cleanup } = tmpStore()
  await applySnapshot(store, snap({ redirects: [{ source: '/a', destination: '/b', type: 301, active: true }] }))
  await store.incrementHit('/a')
  await store.incrementHit('/a')
  const h = await healthPayload(store, '0.1.0', 'x')
  assert.equal(h.version, '0.1.0')
  assert.equal(h.siteSlug, 'x')
  assert.equal(h.snapshotVersion, 2)
  assert.deepEqual(h.redirectHits, [{ source: '/a', hits: 2 }])
  assert.deepEqual(h.counts, { pages: 0, redirects: 1, articles: 0, storeFailures: 0 })
  // Reading health twice reports the same deltas: only a 2xx from the hub clears them, so a
  // ping that never arrives loses nothing.
  assert.deepEqual((await healthPayload(store, '0.1.0', 'x')).redirectHits, [{ source: '/a', hits: 2 }])
  cleanup()
})

test('the health payload reports at most MAX_REDIRECT_HITS sources, busiest first', async () => {
  const { store, cleanup } = tmpStore()
  const redirects = Array.from({ length: MAX_REDIRECT_HITS + 5 }, (_, i) => ({ source: `/r${i}`, destination: '/b', type: 301 as const, active: true }))
  await applySnapshot(store, snap({ redirects }))
  for (const r of redirects) await store.incrementHit(r.source)
  await store.incrementHit('/r7')
  const h = await healthPayload(store, '0.1.0', 'x')
  assert.equal(h.redirectHits.length, MAX_REDIRECT_HITS)
  assert.deepEqual(h.redirectHits[0], { source: '/r7', hits: 2 })
  cleanup()
})

test('hits are cleared only by what the hub acknowledged', async () => {
  const { store, cleanup } = tmpStore()
  await applySnapshot(store, snap({ redirects: [{ source: '/a', destination: '/b', type: 301, active: true }] }))
  await store.incrementHit('/a')
  await store.incrementHit('/a')
  const reported = await store.peekHits()
  await store.incrementHit('/a')            // counted while the request was in flight
  await store.takeHits(reported)
  assert.deepEqual(await store.peekHits(), [{ source: '/a', hits: 1 }])
  cleanup()
})

test('health on an empty store still answers', async () => {
  const { store, cleanup } = tmpStore()
  const h = await healthPayload(store, '0.1.0', 'x')
  assert.equal(h.snapshotVersion, 0)
  assert.equal(h.lastSyncAt, null)
  cleanup()
})
