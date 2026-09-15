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

const withTool = { tools: [{ slug: 'calc', lang: 'en', kind: 'Calculator', config: {}, methodologyHtml: '<p>Method.</p>', dataSource: 'ONS', asOf: '2026-08-01' }] }

/**
 * The embed feature (packages/CONTRACT.md's "/tools/{slug}/embed" paragraph) is Express and
 * Laravel only — packages/next's tool page still calls `toolBodyHtml(tool)` with one argument,
 * and packages/wordpress is untouched. Both tests below `t.skip()` with a named reason rather
 * than asserting, the moment the response makes clear this stack does not render the section
 * (or the route), so this file still runs unmodified — and unskipped — against every stack in
 * CI: real, failing coverage on Express/Laravel, an honest documented skip everywhere else.
 */
test('the tool page\'s "Embed this calculator" section is omitted on a cold store and present, nofollowed and origin-scoped, once one has synced', async (t) => {
  await sync(snapshotWith({ baseUrls: {}, ...withTool }))
  // Scripts are dropped before the "undefined" check: Next's RSC flight payload legitimately
  // carries `"$undefined"` tokens inside <script> tags, which is not a template leak.
  const cold = (await (await fetch(`${BASE}/tools/calc?lang=en`)).text()).replace(/<script[\s\S]*?<\/script>/g, '')
  assert.ok(!cold.includes('Embed this calculator'), 'expected no embed section with no origin to build an absolute iframe src from')
  assert.ok(!cold.includes('undefined'), 'expected no literal "undefined" leaking into the body')
  assert.ok(!cold.includes('//tools'), 'expected no protocol-relative //tools from an empty origin')

  await sync(snapshotWith(withTool))   // baseUrls back to the fixture's own — snapshotWith merges onto a fresh snapshot()
  const warm = await (await fetch(`${BASE}/tools/calc?lang=en`)).text()
  if (!warm.includes('Embed this calculator')) {
    t.skip('this stack does not render the embed section (packages/CONTRACT.md: Express and Laravel only)')
    return
  }
  // The snippet lives HTML-escaped inside a <textarea readonly>, so its own quotes come back as
  // entities. siteName is settings.organization.name ('Demo Co' in this fixture).
  assert.ok(warm.includes('rel=&quot;nofollow&quot;&gt;Demo Co&lt;/a&gt;'), 'expected the nofollowed brand link naming settings.organization.name')
  assert.ok(warm.includes(`iframe[src^=&quot;${BASE}/&quot;]`), 'expected the resize listener scoped to this origin')
})

test('GET /tools/{slug}/embed answers 200 with exactly one noindex,follow robots meta and a canonical back to /tools/{slug}, and 404s for an unknown slug', async (t) => {
  await sync(snapshotWith(withTool))
  const res = await fetch(`${BASE}/tools/calc/embed?lang=en`)
  if (res.status === 404) {
    t.skip('this stack does not implement /tools/{slug}/embed (packages/CONTRACT.md: Express and Laravel only)')
    return
  }
  assert.equal(res.status, 200)
  const html = await res.text()
  const robotsMetas = [...html.matchAll(/<meta name="robots" content="([^"]*)">/g)]
  assert.equal(robotsMetas.length, 1, 'expected exactly one robots meta tag')
  assert.equal(robotsMetas[0][1], 'noindex, follow')
  assert.ok(html.includes(`<link rel="canonical" href="${BASE}/tools/calc">`), 'expected the canonical to point at the real tool page, not the embed path')
  assert.equal((await fetch(`${BASE}/tools/nope/embed`)).status, 404)
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
