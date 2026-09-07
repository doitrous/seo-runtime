import assert from 'node:assert/strict'
import test from 'node:test'
import { isReserved, matchRedirect, redirectFor, safeDestination } from './redirects.ts'
import { normalizePath } from './types.ts'
import type { StoredRedirect } from './types.ts'

const rows: StoredRedirect[] = [
  { source: '/en/old', destination: '/en/new', type: 301, active: true },
  { source: '/en/off', destination: '/en/new', type: 302, active: false },
  { source: '/api/old', destination: '/api/new', type: 301, active: true },
]

test('paths are normalized before matching', () => {
  assert.equal(normalizePath('/en/old/'), '/en/old')
  assert.equal(normalizePath('/en/old?x=1#y'), '/en/old')
  assert.equal(normalizePath('en/old'), '/en/old')
  assert.equal(normalizePath('/'), '/')
  assert.equal(normalizePath(''), '/')
})

test('an active exact match wins, in any of the four types', () => {
  assert.equal(matchRedirect('/en/old', rows, [])!.type, 301)
  assert.equal(matchRedirect('/en/old/', rows, [])!.destination, '/en/new')
  assert.equal(matchRedirect('/en/other', rows, []), null)
})

test('an inactive row never matches', () => {
  assert.equal(matchRedirect('/en/off', rows, []), null)
})

test('reserved prefixes are skipped, matching whole segments only', () => {
  assert.equal(matchRedirect('/api/old', rows, ['/api']), null)
  assert.equal(isReserved('/api/x', ['/api']), true)
  assert.equal(isReserved('/api', ['/api']), true)
  assert.equal(isReserved('/apifoo', ['/api']), false)
  assert.equal(isReserved('/en/api', ['/api']), false)
})

test('destinations must be site-relative or https', () => {
  assert.equal(safeDestination('/en/new'), '/en/new')
  assert.equal(safeDestination('https://x.com/a'), 'https://x.com/a')
  assert.equal(safeDestination('http://x.com/a'), null)
  assert.equal(safeDestination('//evil.com'), null)
  assert.equal(safeDestination('javascript:alert(1)'), null)
  assert.equal(safeDestination(''), null)
})

test('redirectFor reads the store, counts the hit and returns destination plus status', async () => {
  const hits: string[] = []
  const store = {
    getRedirect: async (p: string) => rows.find((r) => r.source === p && r.active) ?? null,
    incrementHit: async (s: string) => void hits.push(s),
  } as never
  assert.deepEqual(await redirectFor(store, 'https://x.com/en/old?utm=1'), { destination: '/en/new', status: 301 })
  assert.deepEqual(hits, ['/en/old'])
})

test('redirectFor returns null for reserved prefixes without touching the store', async () => {
  let called = false
  const store = { getRedirect: async () => { called = true; return null }, incrementHit: async () => {} } as never
  assert.equal(await redirectFor(store, 'https://x.com/api/old', ['/api']), null)
  assert.equal(called, false)
})

test('redirectFor drops an unsafe destination rather than emitting it', async () => {
  const store = {
    getRedirect: async () => ({ source: '/a', destination: 'http://evil.com', type: 301, active: true }),
    incrementHit: async () => {},
  } as never
  assert.equal(await redirectFor(store, 'https://x.com/a'), null)
})

test('a store failure never breaks the request', async () => {
  const store = { getRedirect: async () => { throw new Error('down') }, incrementHit: async () => {} } as never
  assert.equal(await redirectFor(store, 'https://x.com/a'), null)
})
