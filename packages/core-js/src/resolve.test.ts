import assert from 'node:assert/strict'
import test from 'node:test'
import { composeSeo, resolveSeo, storeFailures } from './resolve.ts'
import { EMPTY_META, EMPTY_SETTINGS, type Settings, type SnapshotPage } from './types.ts'

const settings: Settings = {
  ...EMPTY_SETTINGS,
  baseUrls: { en: 'https://x.com', ar: 'https://x.com' },
  brandSuffix: ' | X',
  defaultOgImage: 'https://x.com/og.png',
  organization: { name: 'X Clinic', logo: 'https://x.com/logo.png', sameAs: ['https://fb.com/x'], phone: '+1', email: 'a@x.com', address: 'Cairo', hours: 'Mo-Fr', type: 'MedicalClinic' },
  pageDefaults: { doctor: { titleTemplate: '%s, dermatologist', schemaType: 'Physician', changefreq: 'weekly', priority: 0.8 } },
  twitterHandle: '@x',
}

const page: SnapshotPage = {
  key: 'doctor:42', type: 'doctor', lang: 'en', path: '/en/doctors/anna', group: 'doctor:42',
  title: 'Anna Fahmy', updatedAt: '2026-09-01T00:00:00.000Z',
  seo: {
    seoTitle: 'Dr Anna Fahmy', metaDescription: 'Book a consultation.', canonical: '',
    index: true, follow: true, includeInSitemap: true, priority: 0.9,
    og: EMPTY_META, twitter: EMPTY_META, schemaType: '', structuredData: [], faq: [],
  },
}

test('the page record wins and the brand suffix is appended', () => {
  const r = composeSeo(page, settings, page.path, 'en')
  assert.equal(r.title, 'Dr Anna Fahmy | X')
  assert.equal(r.description, 'Book a consultation.')
  assert.equal(r.canonical, 'https://x.com/en/doctors/anna')
  assert.deepEqual(r.robots, { index: true, follow: true })
})

test('a title that already ends with the brand suffix is not suffixed twice', () => {
  const r = composeSeo({ ...page, seo: { ...page.seo, seoTitle: 'Dr Anna Fahmy | X' } }, settings, page.path, 'en')
  assert.equal(r.title, 'Dr Anna Fahmy | X')
})

test('an empty SEO title falls back to the page type template, then the page title', () => {
  const r = composeSeo({ ...page, seo: { ...page.seo, seoTitle: '' } }, settings, page.path, 'en')
  assert.equal(r.title, 'Anna Fahmy, dermatologist | X')
  const untyped = composeSeo({ ...page, type: 'other', seo: { ...page.seo, seoTitle: '' } }, settings, page.path, 'en')
  assert.equal(untyped.title, 'Anna Fahmy | X')
})

test('an explicit canonical overrides the computed one', () => {
  const r = composeSeo({ ...page, seo: { ...page.seo, canonical: 'https://x.com/en/doctors/anna-fahmy' } }, settings, page.path, 'en')
  assert.equal(r.canonical, 'https://x.com/en/doctors/anna-fahmy')
})

test('OG and Twitter fall back to the page values then the site defaults', () => {
  const r = composeSeo(page, settings, page.path, 'en')
  assert.equal(r.og.title, 'Dr Anna Fahmy | X')
  assert.equal(r.og.description, 'Book a consultation.')
  assert.equal(r.og.image, 'https://x.com/og.png')
  assert.equal(r.twitter.image, 'https://x.com/og.png')
  const own = composeSeo({ ...page, seo: { ...page.seo, og: { title: 'OG', description: 'OGD', image: 'https://x.com/1.png' } } }, settings, page.path, 'en')
  assert.equal(own.og.title, 'OG')
  assert.equal(own.og.image, 'https://x.com/1.png')
})

test('alternates come from the page group, with x-default on the first language', () => {
  const ar: SnapshotPage = { ...page, lang: 'ar', path: '/ar/doctors/anna' }
  const r = composeSeo(page, settings, page.path, 'en', [page, ar])
  assert.deepEqual(r.alternates, {
    en: 'https://x.com/en/doctors/anna',
    ar: 'https://x.com/ar/doctors/anna',
    'x-default': 'https://x.com/en/doctors/anna',
  })
})

test('a page alone in its group advertises only itself', () => {
  const r = composeSeo(page, settings, page.path, 'en', [page])
  assert.deepEqual(Object.keys(r.alternates), ['en', 'x-default'])
})

test('the organization is the last JSON-LD entry and the page schema type is used', () => {
  const r = composeSeo(page, settings, page.path, 'en')
  const types = r.jsonld.map((e) => e['@type'])
  assert.deepEqual(types, ['Physician', 'MedicalClinic'])
  assert.equal(r.jsonld[0]['@context'], 'https://schema.org')
})

test('a structured data override replaces the generated page entry', () => {
  const r = composeSeo({ ...page, seo: { ...page.seo, structuredData: [{ '@context': 'https://schema.org', '@type': 'FAQPage' }] } }, settings, page.path, 'en')
  assert.deepEqual(r.jsonld.map((e) => e['@type']), ['FAQPage', 'MedicalClinic'])
})

test('an invalid structured data override is dropped', () => {
  const r = composeSeo({ ...page, seo: { ...page.seo, structuredData: [{ '@type': 'FAQPage' } as Record<string, unknown>] } }, settings, page.path, 'en')
  assert.deepEqual(r.jsonld.map((e) => e['@type']), ['Physician', 'MedicalClinic'])
})

test('the kill switch forces noindex on every page', () => {
  const r = composeSeo(page, { ...settings, indexingEnabled: false }, page.path, 'en')
  assert.equal(r.robots.index, false)
  assert.equal(r.robots.follow, true)
})

test('an unknown page returns the site defaults and never throws', () => {
  const r = composeSeo(null, settings, '/en/nothing', 'en')
  assert.equal(r.title, 'X Clinic | X')
  assert.equal(r.canonical, 'https://x.com/en/nothing')
  assert.deepEqual(r.robots, { index: true, follow: true })
})

/** A store stub that answers only the two per-key reads `resolveSeo` is allowed to make. */
function keyStore(pages: SnapshotPage[], settings: Settings) {
  let snapshotReads = 0
  return {
    reads: () => snapshotReads,
    store: {
      async getSettings() { return settings },
      async getPage(path: string, lang: string) {
        return pages.find((p) => p.path === path && p.lang === lang) ?? null
      },
      async listGroup(groupKey: string) { return groupKey ? pages.filter((p) => p.group === groupKey) : [] },
      async getSnapshot() { snapshotReads++; return null },
    } as never,
  }
}

test('resolveSeo reads the page by key and never loads the whole store', async () => {
  const ar: SnapshotPage = { ...page, lang: 'ar', path: '/ar/doctors/anna' }
  const { store, reads } = keyStore([page, ar], settings)
  const r = await resolveSeo(store, '/en/doctors/anna', 'en')
  assert.equal(r.title, 'Dr Anna Fahmy | X')
  assert.deepEqual(Object.keys(r.alternates).sort(), ['ar', 'en', 'x-default'])
  // The guard that keeps a render off a full SELECT * / whole-file read on every request.
  assert.equal(reads(), 0)
})

test('resolveSeo normalizes the path before looking it up', async () => {
  const { store } = keyStore([page], settings)
  for (const p of ['/en/doctors/anna/', '/en/doctors/anna?utm=x', '/en/doctors/anna#top']) {
    assert.equal((await resolveSeo(store, p, 'en')).title, 'Dr Anna Fahmy | X', p)
  }
})

test('an empty store resolves to blanks rather than throwing', async () => {
  const store = { getSettings: async () => null, getPage: async () => null, listGroup: async () => [] } as never
  const r = await resolveSeo(store, '/en/a', 'en')
  assert.equal(r.title, '')
  assert.equal(r.canonical, '/en/a')
  assert.deepEqual(r.jsonld, [])
})

test('resolveSeo swallows a store failure and counts it', async () => {
  const store = { getSettings: async () => { throw new Error('db down') } } as never
  const before = storeFailures()
  const r = await resolveSeo(store, '/en/a', 'en')
  assert.equal(r.title, '')
  assert.deepEqual(r.robots, { index: true, follow: true })
  // Swallowing is right (rendering never throws) but silence is not: the health ping reports
  // this counter, so a permanently broken store is visible in the hub instead of showing up as
  // a mysteriously blank <title>.
  assert.equal(storeFailures(), before + 1)
})

test('a page title containing $& is inserted literally into the title template', () => {
  const r = composeSeo({ ...page, title: 'Anna $& Fahmy', seo: { ...page.seo, seoTitle: '' } }, settings, page.path, 'en')
  assert.equal(r.title, 'Anna $& Fahmy, dermatologist | X')
})
