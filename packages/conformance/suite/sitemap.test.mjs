import assert from 'node:assert/strict'
import test from 'node:test'
import { articles, BASE, snapshot, sync } from './fixture.mjs'

test.before(async () => { await sync(snapshot()) })

test('the sitemap lists the indexable pages with alternates', async () => {
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  assert.match(xml, /<urlset/)
  assert.match(xml, new RegExp(`<loc>${BASE}/en/a</loc>`))
  assert.match(xml, /hreflang="ar"/)
  assert.match(xml, /hreflang="x-default"/)
  assert.match(xml, /<changefreq>weekly<\/changefreq>/)
  assert.match(xml, /<priority>0\.8<\/priority>/)
  // packages/CONTRACT.md: "lastmod from updatedAt". The fixture's page carries a fixed
  // updatedAt of 2026-09-01T00:00:00.000Z, so lastmod must be that exact date (both packages
  // render it via core-js's shared `sitemapEntries`/`day()`, so this must hold on both stacks —
  // a mismatch between them would be a contract violation, not something to loosen here).
  assert.match(xml, new RegExp(`<loc>${BASE}/en/a</loc><lastmod>2026-09-01</lastmod>`))
})

test('a noindex page is excluded', async () => {
  const s = snapshot()
  s.pages[0].seo.index = false
  await sync(s)
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  assert.doesNotMatch(xml, new RegExp(`<loc>${BASE}/en/a</loc>`))
  await sync(snapshot())
})

test('an ingested article appears in the sitemap with a lastmod', async () => {
  await articles({ externalId: 700, articles: [{ lang: 'en', title: 'Hair', slug: 'conformance-hair', bodyMd: '# Hair\n\nBody.' }] })
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  assert.match(xml, /conformance-hair/)
  // The article's updatedAt is set to the ingest time (packages/core-js/src/articles.ts), so its
  // lastmod is today's date (UTC) in the same YYYY-MM-DD form as a page's — not empty, not a
  // full datetime, on either stack.
  const today = new Date().toISOString().slice(0, 10)
  assert.match(xml, new RegExp(`<loc>[^<]*conformance-hair[^<]*</loc><lastmod>${today}</lastmod>`))
})

test('the kill switch empties the sitemap', async () => {
  const off = snapshot()
  off.settings.indexingEnabled = false
  await sync(off)
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  assert.doesNotMatch(xml, /<url>/)
  await sync(snapshot())   // restore indexing for the rest of the suite
})
