import assert from 'node:assert/strict'
import test from 'node:test'
import { articles, auth, BASE, health, snapshot, sync } from './fixture.mjs'

// Per-country pages (runtime 0.2.0, hub contract 1.20.0 — packages/CONTRACT.md's "Per-country
// pages" section). Every demo serves ['en', 'ar'] with the default article path
// /{lang}/blog/{slug}, so the lead of `ar` stays at /ar/blog/… and ar-AE moves to /ar-ae/blog/….

test.before(async () => { await sync(snapshot()) })

const SLUG = 'conformance-locale'
const item = (lang, locale, slug = SLUG) => ({
  lang, ...(locale ? { locale } : {}), title: `Locale ${locale ?? lang}`, slug,
  bodyMd: `# Locale ${locale ?? lang}\n\nThe body for ${locale ?? lang}.`,
})
const localePayload = () => ({ externalId: 951, articles: [item('ar', 'ar-SA'), item('ar', 'ar-AE'), item('en', 'en-US')] })

test('several locales of one language: the lead keeps the language URL, the rest go under the locale', async () => {
  const res = await articles(localePayload())
  assert.equal(res.status, 200)
  const { results } = await res.json()
  assert.deepEqual(results.map((r) => [r.lang, r.locale]), [['ar', 'ar-SA'], ['ar', 'ar-AE'], ['en', 'en-US']])
  assert.match(results[0].remoteUrl, new RegExp(`^https?://.+/ar/blog/${SLUG}$`))
  assert.match(results[1].remoteUrl, new RegExp(`^https?://.+/ar-ae/blog/${SLUG}$`))
  assert.match(results[2].remoteUrl, new RegExp(`^https?://.+/en/blog/${SLUG}$`))
  // Distinct remote ids, one per stored version.
  assert.equal(new Set(results.map((r) => r.remoteId)).size, 3)
})

test('a re-ingest updates every version in place', async () => {
  await articles(localePayload())
  await articles(localePayload())
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  const locs = xml.match(new RegExp(`<loc>[^<]*/${SLUG}</loc>`, 'g')) ?? []
  assert.equal(locs.length, 3)
})

test('the sitemap lists every version with the full hreflang set and x-default = the source', async () => {
  await articles(localePayload())
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  const urls = (xml.match(/<url>[\s\S]*?<\/url>/g) ?? []).filter((u) => u.includes(`/${SLUG}</loc>`))
  assert.equal(urls.length, 3)
  for (const u of urls) {
    for (const code of ['ar-SA', 'ar-AE', 'en-US', 'ar', 'en']) assert.match(u, new RegExp(`hreflang="${code}"`), code)
    assert.match(u, new RegExp(`hreflang="ar-AE" href="https?://[^"]+/ar-ae/blog/${SLUG}"`))
    assert.match(u, new RegExp(`hreflang="ar" href="https?://[^"]+/ar/blog/${SLUG}"`))
    assert.match(u, new RegExp(`hreflang="x-default" href="https?://[^"]+/ar/blog/${SLUG}"`))
  }
})

test('the page list carries one article page per version', async () => {
  await articles(localePayload())
  const { pages } = await (await fetch(`${BASE}/api/seo/pages`, { headers: auth })).json()
  const mine = pages.filter((p) => p.type === 'article' && String(p.key).startsWith('article:951'))
  assert.deepEqual(mine.map((p) => p.path).sort(), [`/ar-ae/blog/${SLUG}`, `/ar/blog/${SLUG}`, `/en/blog/${SLUG}`])
  assert.ok(mine.some((p) => p.key === 'article:951:ar-AE' && p.locale === 'ar-AE'))
})

test('a slug is taken per locale: another job may not reuse it under the same locale', async () => {
  await articles(localePayload())
  const res = await articles({ externalId: 952, articles: [item('ar', 'ar-SA', 'conformance-locale-other'), item('ar', 'ar-AE')] })
  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: 'slug_taken', slug: SLUG, lang: 'ar', locale: 'ar-AE' })
})

test('a payload without locale is answered exactly as before (no locale key)', async () => {
  const res = await articles({ externalId: 953, articles: [item('en', undefined, 'conformance-locale-legacy')] })
  assert.equal(res.status, 200)
  const { results } = await res.json()
  assert.deepEqual(Object.keys(results[0]).sort(), ['lang', 'remoteId', 'remoteUrl'])
  assert.equal(results[0].remoteId, '953:en')
})

test('a locale of another language is a 400 naming the field', async () => {
  const res = await articles({ externalId: 954, articles: [item('ar', 'en-US', 'conformance-locale-bad')] })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'invalid articles[0].locale' })
})

test('health advertises localeUrls', async () => {
  const body = await (await health()).json()
  assert.ok(Array.isArray(body.features) && body.features.includes('localeUrls'))
})
