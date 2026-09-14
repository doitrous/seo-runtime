import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, snapshot, snapshotWith, sync } from './fixture.mjs'

// Phase 5 v2 content types: authors/helpEntries/tools/verification/indexNowKey all render
// straight from whatever the last synced snapshot's `settings` carries — packages/CONTRACT.md's
// "v2 fields" section. Package unit tests (per stack) already cover the escaping/shape rules in
// isolation; this file is the stack-agnostic proof that a real synced snapshot actually reaches
// the rendered page over HTTP, on whichever stack is under test.
test.before(async () => { await sync(snapshot()) })

test('an author page renders a Person JSON-LD block from the snapshot, and 404s for an unknown slug', async () => {
  await sync(snapshotWith({
    authors: [{ slug: 'jane', name: 'Jane Doe', title: 'Editor', credentials: 'MD', sameAs: ['https://x.example/jane'], bio: 'Bio.' }],
  }))
  const html = await (await fetch(`${BASE}/authors/jane`)).text()
  assert.match(html, /<h1>Jane Doe<\/h1>/)
  assert.match(html, /"@type":"Person"/)
  assert.equal((await fetch(`${BASE}/authors/nope`)).status, 404)
})

test('a help page puts the question in an h1, the answer first, with an Article JSON-LD carrying dateModified', async () => {
  await sync(snapshotWith({
    helpEntries: [{
      slug: 'refund', lang: 'en', question: 'How do refunds work?', answerHtml: '<p>Answer.</p>',
      moneyPageUrl: '/pricing', updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  }))
  const html = await (await fetch(`${BASE}/help/refund?lang=en`)).text()
  const h1 = html.indexOf('<h1>How do refunds work?</h1>')
  const answer = html.indexOf('<p>Answer.</p>')
  assert.ok(h1 !== -1 && answer !== -1 && h1 < answer, 'expected the question as an h1 before the answer')
  assert.match(html, /"@type":"Article"/)
  assert.match(html, /"dateModified":"2026-09-01T00:00:00\.000Z"/)
})

test('a tool page renders the placeholder container with a WebApplication JSON-LD', async () => {
  await sync(snapshotWith({
    tools: [{ slug: 'calc', lang: 'en', kind: 'Calculator', config: {}, methodologyHtml: '<p>Method.</p>', dataSource: 'ONS', asOf: '2026-08-01' }],
  }))
  const html = await (await fetch(`${BASE}/tools/calc?lang=en`)).text()
  assert.match(html, /id="seo-tool-calc"/)
  assert.match(html, /"@type":"WebApplication"/)
})

test('verification meta and the ga4 snippet are rendered in the head when configured', async () => {
  await sync(snapshotWith({ verification: { googleMeta: 'g-abc', bingMeta: 'b-xyz' }, ga4MeasurementId: 'G-ABC123' }))
  const html = await (await fetch(`${BASE}/en`)).text()
  assert.match(html, /name="google-site-verification" content="g-abc"/)
  assert.match(html, /name="msvalidate\.01" content="b-xyz"/)
  assert.match(html, /gtag\('config','G-ABC123'\)/)
  await sync(snapshot())   // restore the plain fixture for the rest of the suite
})

test('the IndexNow key file is served at the exact /{key}.txt path, and the key is not leaked at another one', async () => {
  await sync(snapshotWith({ indexNowKey: 'conformance-key-123' }))
  const hit = await fetch(`${BASE}/conformance-key-123.txt`)
  assert.equal(hit.status, 200)
  assert.equal((await hit.text()).trim(), 'conformance-key-123')
  // Not a status-code check: an unmatched .txt path's own status (404, or a host route that
  // legitimately renders something else at that path) is outside this contract's concern —
  // indexNowKeyFile's only promise is that it never answers with the key anywhere but the one
  // exact path (packages/core-js/src/entities.ts), which is what this checks instead.
  const missBody = (await (await fetch(`${BASE}/not-the-key.txt`)).text()).trim()
  assert.notEqual(missBody, 'conformance-key-123')
  await sync(snapshot())   // restore the plain fixture for the rest of the suite
})
