import assert from 'node:assert/strict'
import test from 'node:test'
import { articles, BASE, SECRET, snapshot, sync } from './fixture.mjs'

test.before(async () => { await sync(snapshot()) })

const payload = (over = {}) => ({
  externalId: 901,
  author: { name: 'Dr A', credentials: 'MD' },
  image: { url: `${BASE}/a.png`, alt: 'a clinic room' },
  articles: [{
    lang: 'en', title: 'Conformance article', slug: 'conformance-article',
    metaTitle: 'Conformance article', metaDescription: 'A description.',
    bodyMd: '# Conformance article\n\nThe body.', faq: [{ q: 'Q', a: 'A' }],
    schemaJsonld: [{ '@context': 'https://schema.org', '@type': 'BlogPosting' }],
    introduction: 'A lede.', references: [{ title: 'Study', url: 'https://pubmed.gov/1' }],
  }],
  ...over,
})

test('an article is ingested and answered with absolute URLs', async () => {
  const res = await articles(payload())
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.results[0].lang, 'en')
  assert.match(body.results[0].remoteUrl, /^https?:\/\/.+\/en\/blog\/conformance-article$/)
})

test('an unsupported language is skipped, not rejected', async () => {
  const p = payload()
  p.articles.push({ ...p.articles[0], lang: 'zz' })
  const body = await (await articles(p)).json()
  assert.deepEqual(body.skipped, ['zz'])
})

test('a re-ingest updates rather than duplicating', async () => {
  await articles(payload())
  const changed = payload()
  changed.articles[0].title = 'Conformance article, revised'
  const body = await (await articles(changed)).json()
  assert.equal(body.results.length, 1)
  // A count of 1 is also true of a first ingest, so check the <loc> count in the sitemap: a
  // duplicate would show up as a second <loc> for the same slug. Counting the raw substring
  // instead would also catch the legitimate hreflang="en" / hreflang="x-default" alternate links
  // that a single-language article always gets (see sitemap.test.mjs) and over-count on a
  // correct, non-duplicated entry.
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  const locs = xml.match(/<loc>[^<]*conformance-article[^<]*<\/loc>/g) ?? []
  assert.equal(locs.length, 1)
})

test('a different job reusing a live slug is a 409', async () => {
  await articles(payload())
  const res = await articles(payload({ externalId: 902 }))
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /slug/)
})

test('a body over 2 MB is refused with 413, chunked or not', async () => {
  const big = payload()
  big.articles[0].bodyMd = 'x'.repeat(3 * 1024 * 1024)
  assert.equal((await articles(big)).status, 413)

  // No content-length: the limit has to be enforced on the stream.
  const chunk = new TextEncoder().encode('x'.repeat(512 * 1024))
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 6; i++) c.enqueue(chunk); c.close() } })
  const res = await fetch(`${BASE}/api/articles`, {
    method: 'POST', headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: stream, duplex: 'half',
  })
  assert.equal(res.status, 413)
})

test('an invalid payload is a 400 naming the field', async () => {
  const res = await articles({ externalId: 'nine', articles: [] })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /externalId/)
})

test('articles without the secret are 401', async () => {
  const res = await fetch(`${BASE}/api/articles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })
  assert.equal(res.status, 401)
})
