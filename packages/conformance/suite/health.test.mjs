import assert from 'node:assert/strict'
import test from 'node:test'
import { articles, BASE, health, healthAnon, nextVersion, snapshot, SLUG, sync } from './fixture.mjs'

test('health requires the secret and reports the contract fields', async () => {
  const v = nextVersion()
  await sync(snapshot({ version: v }))
  const anon = await healthAnon()
  assert.equal(anon.status, 401)
  assert.deepEqual(await anon.json(), { error: 'unauthorized' })
  const res = await health()
  assert.equal(res.status, 200)
  const body = await res.json()
  for (const k of ['version', 'siteSlug', 'lastSyncAt', 'snapshotVersion', 'counts', 'redirectHits'])
    assert.ok(k in body, `health is missing ${k}`)
  assert.equal(body.siteSlug, SLUG)
  assert.equal(body.snapshotVersion, v)
  assert.equal(typeof body.counts.pages, 'number')
  assert.ok(Array.isArray(body.redirectHits))
})

test('reading health twice in a row does not change redirectHits', async () => {
  const first = await (await health()).json()
  const second = await (await health()).json()
  assert.deepEqual(second.redirectHits, first.redirectHits)
})

test('a snapshot addressed to another site is refused', async () => {
  const res = await sync(snapshot({ siteSlug: `${SLUG}-not-me` }))
  assert.notEqual((await res.json()).status, 'applied')
  assert.equal((await (await health()).json()).siteSlug, SLUG)
})

test('a malformed snapshot is a clean 400, never a 500', async () => {
  const bad = snapshot()
  bad.pages = [{ key: 'x' }]
  const res = await sync(bad)
  assert.ok(res.status === 400 || (await res.clone().json()).status === 'invalid')
  assert.ok(res.status < 500)
})

test('the page provider lists pages with the contract shape', async () => {
  const res = await fetch(`${BASE}/api/seo/pages`, { headers: { Authorization: `Bearer ${process.env.CONFORMANCE_SECRET}` } })
  assert.equal(res.status, 200)
  const { pages } = await res.json()
  assert.ok(Array.isArray(pages))
  for (const p of pages) for (const k of ['key', 'type', 'lang', 'path', 'title', 'updatedAt'])
    assert.ok(k in p, `page is missing ${k}`)
})

test('the page provider is refused without the secret', async () => {
  const res = await fetch(`${BASE}/api/seo/pages`)
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
})

// packages/CONTRACT.md: "GET /api/seo/pages ... plus the runtime's own article pages at
// articlePath(lang, slug). Each article appears exactly once per stored language." This
// ingests one article in two languages and checks both show up, once each, at the demo's
// default articlePath (/{lang}/blog/{slug}), typed as an article page with an updatedAt.
test('an ingested article appears once per language in the page provider, at articlePath', async () => {
  const slug = 'conformance-pages-listing'
  await articles({
    externalId: 960,
    articles: [
      { lang: 'en', title: 'Listing check', slug, bodyMd: '# Listing check\n\nBody.' },
      { lang: 'ar', title: 'فحص القائمة', slug, bodyMd: '# فحص القائمة\n\nمتن.' },
    ],
  })
  const res = await fetch(`${BASE}/api/seo/pages`, { headers: { Authorization: `Bearer ${process.env.CONFORMANCE_SECRET}` } })
  const { pages } = await res.json()
  for (const lang of ['en', 'ar']) {
    const matches = pages.filter((p) => p.lang === lang && p.path === `/${lang}/blog/${slug}`)
    assert.equal(matches.length, 1, `expected exactly one ${lang} page at /${lang}/blog/${slug}`)
    assert.equal(matches[0].type, 'article')
    assert.ok(matches[0].updatedAt, 'article page is missing updatedAt')
  }
})
