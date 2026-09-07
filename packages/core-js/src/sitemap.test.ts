import assert from 'node:assert/strict'
import test from 'node:test'
import { SITEMAP_PAGE_SIZE, sitemapEntries, sitemapXml, xmlEscape } from './sitemap.ts'
import { robotsTxt } from './robots.ts'
import { DEFAULT_PAGE_DEFAULTS, EMPTY_META, EMPTY_SETTINGS, type Snapshot, type SnapshotPage, type StoredArticle } from './types.ts'

const seo = { seoTitle: 'T', metaDescription: 'D', canonical: '', index: true, follow: true, includeInSitemap: true, priority: 0.9, og: EMPTY_META, twitter: EMPTY_META, schemaType: '', structuredData: [], faq: [] }
const page = (over: Partial<SnapshotPage> = {}): SnapshotPage => ({
  key: 'doctor:42', type: 'doctor', lang: 'en', path: '/en/doctors/anna', group: 'doctor:42',
  title: 'Anna', updatedAt: '2026-09-01T00:00:00.000Z', seo, ...over,
})
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, siteSlug: 'x',
  settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://x.com', ar: 'https://x.com' }, pageDefaults: { doctor: { titleTemplate: '%s', schemaType: 'Physician', changefreq: 'weekly', priority: 0.8 } }, robotsExtra: ['Disallow: /tmp'] },
  pages: [page()], redirects: [], ...over,
})
const article = (over: Partial<StoredArticle> = {}): StoredArticle => ({
  externalId: 9, lang: 'en', slug: 'hair', title: 'Hair', metaTitle: '', metaDescription: '', bodyMd: '', bodyHtml: '',
  faq: [], schemaJsonld: [], imageUrl: null, imageAlt: null, authorName: null, authorCredentials: null,
  references: [], og: EMPTY_META, extra: {}, publishedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', ...over,
})

test('an indexable page in the sitemap becomes one entry with its type changefreq', () => {
  const [e] = sitemapEntries(snap(), [])
  assert.equal(e.loc, 'https://x.com/en/doctors/anna')
  assert.equal(e.changefreq, 'weekly')
  assert.equal(e.priority, 0.9)
  assert.equal(e.lastmod, '2026-09-01')
})

test('noindex or excluded pages are left out', () => {
  assert.equal(sitemapEntries(snap({ pages: [page({ seo: { ...seo, index: false } })] }), []).length, 0)
  assert.equal(sitemapEntries(snap({ pages: [page({ seo: { ...seo, includeInSitemap: false } })] }), []).length, 0)
})

test('alternates come from the page group and include x-default', () => {
  const s = snap({ pages: [page(), page({ lang: 'ar', path: '/ar/doctors/anna' })] })
  const [en] = sitemapEntries(s, [])
  assert.deepEqual(en.alternates, {
    en: 'https://x.com/en/doctors/anna', ar: 'https://x.com/ar/doctors/anna', 'x-default': 'https://x.com/en/doctors/anna',
  })
})

test('articles are listed per stored language, grouped by external id', () => {
  const entries = sitemapEntries(snap({ pages: [] }), [article(), article({ lang: 'ar', slug: 'hair-ar' })])
  assert.deepEqual(entries.map((e) => e.loc), ['https://x.com/en/blog/hair', 'https://x.com/ar/blog/hair-ar'])
  assert.deepEqual(entries[0].alternates, {
    en: 'https://x.com/en/blog/hair', ar: 'https://x.com/ar/blog/hair-ar', 'x-default': 'https://x.com/en/blog/hair',
  })
})

test('two articles that share a slug in different jobs are not linked as alternates', () => {
  const entries = sitemapEntries(snap({ pages: [] }), [article(), article({ externalId: 10, lang: 'ar', slug: 'hair' })])
  assert.deepEqual(Object.keys(entries[0].alternates), ['en', 'x-default'])
})

test('a site-specific articlePath is honoured everywhere the article appears', () => {
  const aspects = (lang: string, slug: string) => `/${lang}/articles/${slug}`
  const entries = sitemapEntries(snap({ pages: [] }), [article(), article({ lang: 'ar', slug: 'hair-ar' })], aspects)
  assert.deepEqual(entries.map((e) => e.loc), ['https://x.com/en/articles/hair', 'https://x.com/ar/articles/hair-ar'])
  assert.deepEqual(entries[0].alternates, {
    en: 'https://x.com/en/articles/hair', ar: 'https://x.com/ar/articles/hair-ar', 'x-default': 'https://x.com/en/articles/hair',
  })
})

test('article priority falls back to the type default, not a magic number', () => {
  const [a] = sitemapEntries(snap({ pages: [] }), [article()])
  assert.equal(a.priority, DEFAULT_PAGE_DEFAULTS.priority)
  const s = snap({ pages: [] })
  s.settings.pageDefaults.article = { titleTemplate: '%s', schemaType: 'Article', changefreq: 'daily', priority: 0.7 }
  assert.equal(sitemapEntries(s, [article()])[0].priority, 0.7)
})

test('the kill switch empties the sitemap', () => {
  const s = snap()
  s.settings.indexingEnabled = false
  assert.deepEqual(sitemapEntries(s, [article()]), [])
})

test('the XML escapes ampersands and carries the alternates namespace', () => {
  const xml = sitemapXml(sitemapEntries(snap({ pages: [page({ path: '/en/a&b' })] }), []))
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/)
  assert.match(xml, /a&amp;b/)
  assert.doesNotMatch(xml, /a&b/)
  assert.equal(xmlEscape(`<a href="x" & 'y'>`), '&lt;a href=&quot;x&quot; &amp; &apos;y&apos;&gt;')
})

// Sitemap index paging is deferred to phase 2 (controller ruling, task B5): a single
// /sitemap.xml is the only file this phase produces. `sitemapEntries` still returns every
// matching URL uncapped; `sitemapXml` refuses to silently truncate past the contract's
// per-file limit and throws instead, so the deferral is visible rather than a quiet data loss.
test('sitemapEntries does not truncate, but sitemapXml refuses to render past the per-file limit', () => {
  const many = Array.from({ length: SITEMAP_PAGE_SIZE + 3 }, (_, i) => page({ key: `p${i}`, path: `/en/p${i}`, group: `p${i}` }))
  const entries = sitemapEntries(snap({ pages: many }), [])
  assert.equal(entries.length, SITEMAP_PAGE_SIZE + 3)
  assert.throws(() => sitemapXml(entries), /5,?000|limit/i)
})

test('a full page of exactly the limit still renders', () => {
  const many = Array.from({ length: SITEMAP_PAGE_SIZE }, (_, i) => page({ key: `p${i}`, path: `/en/p${i}`, group: `p${i}` }))
  const entries = sitemapEntries(snap({ pages: many }), [])
  assert.doesNotThrow(() => sitemapXml(entries))
})

test('robots lists the extra lines and the sitemap', () => {
  const txt = robotsTxt(snap())
  assert.match(txt, /^User-agent: \*/m)
  assert.match(txt, /^Disallow: \/tmp$/m)
  assert.match(txt, /^Sitemap: https:\/\/x\.com\/sitemap\.xml$/m)
})

test('the kill switch disallows everything and lists no sitemap', () => {
  const s = snap()
  s.settings.indexingEnabled = false
  assert.equal(robotsTxt(s).trim(), 'User-agent: *\nDisallow: /')
})

test('with no snapshot robots allows everything and lists nothing', () => {
  assert.equal(robotsTxt(null).trim(), 'User-agent: *\nAllow: /')
})
