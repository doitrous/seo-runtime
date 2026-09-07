import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, health, snapshot, sync } from './fixture.mjs'

test.before(async () => { await sync(snapshot()) })

test('an active redirect answers 301 with the destination', async () => {
  const res = await fetch(`${BASE}/old`, { redirect: 'manual' })
  assert.equal(res.status, 301)
  assert.match(res.headers.get('location') ?? '', /\/en\/a$/)
})

test('a trailing slash and a query string still match', async () => {
  assert.equal((await fetch(`${BASE}/old/?utm_source=x`, { redirect: 'manual' })).status, 301)
})

test('an inactive redirect does not fire', async () => {
  assert.notEqual((await fetch(`${BASE}/off`, { redirect: 'manual' })).status, 302)
})

// One active row per redirect type the contract lists (301 is covered above): each must answer
// with its OWN configured status, not a hard-coded 301 — packages/CONTRACT.md's Redirects
// section names 301, 302, 307 and 308.
for (const type of [302, 307, 308]) {
  test(`a type ${type} redirect answers ${type} with the destination`, async () => {
    const res = await fetch(`${BASE}/old-${type}`, { redirect: 'manual' })
    assert.equal(res.status, type)
    assert.match(res.headers.get('location') ?? '', /\/en\/a$/)
  })
}

test('a reserved prefix is never redirected', async () => {
  assert.notEqual((await fetch(`${BASE}/api/old`, { redirect: 'manual' })).status, 301)
})

test('a non-https absolute destination is dropped', async () => {
  assert.notEqual((await fetch(`${BASE}/bad`, { redirect: 'manual' })).status, 301)
})

// The JSON-file demo store never zeroes a hit counter on its own — only a successful hub health
// ping drains it (packages/CONTRACT.md), and these demos run with no hub configured. So a hit
// count only ever grows, run after run; "hits >= 1 after one hit" is the assertion that is true
// both on a clean store and on one a previous suite run already touched, per the controller
// ruling. `health()` itself must be a pure read: reading it twice must return the same number.
test('a hit is counted, and reading health does not clear it', async () => {
  await fetch(`${BASE}/old`, { redirect: 'manual' })
  const first = await (await health()).json()
  const h1 = first.redirectHits.find((h) => h.source === '/old')
  assert.ok(h1 && h1.hits >= 1, 'expected /old to show at least one hit')
  const second = await (await health()).json()
  const h2 = second.redirectHits.find((h) => h.source === '/old')
  assert.equal(h2.hits, h1.hits, 'GET /api/seo/health must not change redirectHits')
})
