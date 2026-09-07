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
})

test('a noindex page is excluded', async () => {
  const s = snapshot()
  s.pages[0].seo.index = false
  await sync(s)
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  assert.doesNotMatch(xml, new RegExp(`<loc>${BASE}/en/a</loc>`))
  await sync(snapshot())
})

test('an ingested article appears in the sitemap', async () => {
  await articles({ externalId: 700, articles: [{ lang: 'en', title: 'Hair', slug: 'conformance-hair', bodyMd: '# Hair\n\nBody.' }] })
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  assert.match(xml, /conformance-hair/)
})

test('the kill switch empties the sitemap', async () => {
  const off = snapshot()
  off.settings.indexingEnabled = false
  await sync(off)
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  assert.doesNotMatch(xml, /<url>/)
  await sync(snapshot())   // restore indexing for the rest of the suite
})
