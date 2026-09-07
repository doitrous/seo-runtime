import assert from 'node:assert/strict'
import test from 'node:test'
import { JsonFileStore, type Snapshot, EMPTY_SETTINGS } from '@doitrous/seo-runtime-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSeo, withSeoRedirects } from './index.ts'

process.env.SEO_HUB_SECRET = 's3cret'
process.env.SEO_SITE_SLUG = 'demo'

const snapshot: Snapshot = {
  version: 1, siteSlug: 'demo',
  settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://demo.test' }, brandSuffix: ' | Demo', robotsExtra: ['Disallow: /tmp'] },
  pages: [{
    key: 'p:1', type: 'page', lang: 'en', path: '/en/a', group: 'p:1', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z',
    seo: { seoTitle: 'A page', metaDescription: 'About A.', canonical: '', index: true, follow: true, includeInSitemap: true, priority: 0.5, og: { title: '', description: '', image: '' }, twitter: { title: '', description: '', image: '' }, schemaType: '', structuredData: [], faq: [] },
  }],
  redirects: [{ source: '/old', destination: '/en/a', type: 301, active: true }],
}

function runtime(over: Partial<Parameters<typeof createSeo>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'next-pkg-'))
  const store = new JsonFileStore(join(dir, 'state.json'))
  const seo = createSeo({
    store,
    pages: async () => [{ key: 'p:1', type: 'page', lang: 'en', path: '/en/a', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z' }],
    supported: ['en', 'ar'], version: '0.1.0', ...over,
  })
  return { seo, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const post = (path: string, body: unknown, auth = 'Bearer s3cret') =>
  new Request(`https://demo.test${path}`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (path: string, auth = 'Bearer s3cret') =>
  new Request(`https://demo.test${path}`, { headers: { authorization: auth } })
const ctx = (...seo: string[]) => ({ params: Promise.resolve({ seo }) })

test('sync applies a snapshot and answers with the version', async () => {
  const { seo, cleanup } = runtime()
  const res = await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'applied', version: 1 })
  cleanup()
})

test('sync refuses a wrong secret before reading the body', async () => {
  const { seo, cleanup } = runtime()
  const res = await seo.handlers.POST(post('/api/seo/sync', snapshot, 'Bearer wrong'), ctx('sync'))
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
  cleanup()
})

test('a malformed or misdirected snapshot is a 400 {status:invalid}, not a 200 or a 500', async () => {
  const { seo, cleanup } = runtime()
  const malformed = await seo.handlers.POST(post('/api/seo/sync', { nope: true }), ctx('sync'))
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { status: 'invalid', version: 0 })
  // Once a snapshot is stored, one addressed to another site is refused with the stored version.
  await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  const misdirected = await seo.handlers.POST(post('/api/seo/sync', { ...snapshot, version: 9, siteSlug: 'someone-else' }), ctx('sync'))
  assert.equal(misdirected.status, 400)
  assert.deepEqual(await misdirected.json(), { status: 'invalid', version: 1 })
  cleanup()
})

test('an older snapshot is answered stale', async () => {
  const { seo, cleanup } = runtime()
  await seo.handlers.POST(post('/api/seo/sync', { ...snapshot, version: 5 }), ctx('sync'))
  const res = await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  assert.deepEqual(await res.json(), { status: 'stale', version: 5 })
  cleanup()
})

test('the page provider output includes article pages', async () => {
  const { seo, cleanup } = runtime()
  // ctx('articles') — the route segment the catch-all matches on. ctx('..') matches nothing, so
  // the ingest would 404 and the assertion below would be checking an empty store.
  const ingest = await seo.handlers.POST(post('/api/articles', {
    externalId: 9, articles: [{ lang: 'en', title: 'T', slug: 'hair', bodyMd: '# T\n\nBody.' }],
  }), ctx('articles'))
  assert.equal(ingest.status, 200)
  const res = await seo.handlers.GET(get('/api/seo/pages'), ctx('pages'))
  const body = await res.json() as { pages: { path: string; type: string }[] }
  assert.ok(body.pages.some((p) => p.path === '/en/a' && p.type === 'page'))
  assert.ok(body.pages.some((p) => p.path === '/en/blog/hair' && p.type === 'article'))
  cleanup()
})

test('a site-specific articlePath moves the article URL everywhere', async () => {
  const { seo, cleanup } = runtime({ articlePath: (lang, slug) => `/${lang}/articles/${slug}` })
  await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  const ingest = await seo.articleHandler.POST(post('/api/articles', {
    externalId: 9, articles: [{ lang: 'en', title: 'T', slug: 'hair', bodyMd: '# T\n\nBody.' }],
  }))
  assert.equal((await ingest.json() as { results: { remoteUrl: string }[] }).results[0].remoteUrl, 'https://demo.test/en/articles/hair')
  const pages = await (await seo.handlers.GET(get('/api/seo/pages'), ctx('pages'))).json() as { pages: { path: string }[] }
  assert.ok(pages.pages.some((p) => p.path === '/en/articles/hair'))
  cleanup()
})

test('remoteUrl uses each language\'s own base URL, not just the first one', async () => {
  const { seo, cleanup } = runtime()
  const twoOrigins = { ...snapshot, settings: { ...snapshot.settings, baseUrls: { en: 'https://demo.test', ar: 'https://ar.demo.test' } } }
  await seo.handlers.POST(post('/api/seo/sync', twoOrigins), ctx('sync'))
  const res = await seo.articleHandler.POST(post('/api/articles', {
    externalId: 9, articles: [
      { lang: 'en', title: 'T', slug: 'hair', bodyMd: 'x' },
      { lang: 'ar', title: 'T', slug: 'hair-ar', bodyMd: 'x' },
    ],
  }))
  const body = await res.json() as { results: { lang: string; remoteUrl: string }[] }
  assert.equal(body.results.find((r) => r.lang === 'en')!.remoteUrl, 'https://demo.test/en/blog/hair')
  assert.equal(body.results.find((r) => r.lang === 'ar')!.remoteUrl, 'https://ar.demo.test/ar/blog/hair-ar')
  cleanup()
})

test('health is authenticated, reports the version and counts, and does not drain', async () => {
  const { seo, store, cleanup } = runtime()
  await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  assert.equal((await seo.handlers.GET(new Request('https://demo.test/api/seo/health'), ctx('health'))).status, 401)
  await store.incrementHit('/old')
  const res = await seo.handlers.GET(get('/api/seo/health'), ctx('health'))
  const body = await res.json() as { version: string; counts: { pages: number }; redirectHits: unknown[] }
  assert.equal(res.status, 200)
  assert.equal(body.version, '0.1.0')
  assert.equal(body.counts.pages, 1)
  assert.deepEqual(body.redirectHits, [{ source: '/old', hits: 1 }])
  // Reading it twice reports the same hits: only a 2xx from the hub clears them.
  assert.deepEqual((await (await seo.handlers.GET(get('/api/seo/health'), ctx('health'))).json() as { redirectHits: unknown[] }).redirectHits,
    [{ source: '/old', hits: 1 }])
  cleanup()
})

test('the probe returns resolveSeo and needs the secret', async () => {
  const { seo, cleanup } = runtime()
  await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  const res = await seo.handlers.GET(get('/api/seo/probe?path=/en/a&lang=en'), ctx('probe'))
  const body = await res.json() as { title: string; canonical: string }
  assert.equal(body.title, 'A page | Demo')
  assert.equal(body.canonical, 'https://demo.test/en/a')
  assert.equal((await seo.handlers.GET(get('/api/seo/probe?path=/en/a&lang=en', 'Bearer no'), ctx('probe'))).status, 401)
  cleanup()
})

test('an unknown route is a 404', async () => {
  const { seo, cleanup } = runtime()
  assert.equal((await seo.handlers.GET(get('/api/seo/nope'), ctx('nope'))).status, 404)
  cleanup()
})

test('the article route ingests and returns absolute URLs', async () => {
  const { seo, cleanup } = runtime()
  await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  const res = await seo.articleHandler.POST(post('/api/articles', {
    externalId: 9, articles: [{ lang: 'en', title: 'T', slug: 'hair', bodyMd: '# T\n\nBody.' }, { lang: 'de', title: 'T', slug: 'hair', bodyMd: 'x' }],
  }))
  const body = await res.json() as { results: { remoteUrl: string }[]; skipped: string[] }
  assert.equal(body.results[0].remoteUrl, 'https://demo.test/en/blog/hair')
  assert.deepEqual(body.skipped, ['de'])
  cleanup()
})

test('a body over 2 MB is refused, declared or not', async () => {
  const { seo, cleanup } = runtime()
  const declared = new Request('https://demo.test/api/seo/sync', {
    method: 'POST', headers: { authorization: 'Bearer s3cret', 'content-length': String(3 * 1024 * 1024) }, body: '{}',
  })
  assert.equal((await seo.handlers.POST(declared, ctx('sync'))).status, 413)

  // Chunked: no content-length at all. A content-length-only check waves this through.
  const chunk = new Uint8Array(512 * 1024)
  chunk.fill(120)
  const stream = new ReadableStream({
    start(c) { for (let i = 0; i < 6; i++) c.enqueue(chunk); c.close() },
  })
  const chunked = new Request('https://demo.test/api/seo/sync', {
    method: 'POST', headers: { authorization: 'Bearer s3cret' }, body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  assert.equal(chunked.headers.get('content-length'), null)
  assert.equal((await seo.handlers.POST(chunked, ctx('sync'))).status, 413)
  cleanup()
})

test('a redirect proxy falls through instead of blanking the page', async () => {
  const { seo, store, cleanup } = runtime()
  await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  const proxy = withSeoRedirects(store)
  const hit = await proxy({ url: 'https://demo.test/old' })
  assert.equal(hit!.status, 301)
  assert.equal(hit!.headers.get('location'), 'https://demo.test/en/a')
  // The load-bearing one: no redirect means "carry on", not an empty 200 over every page.
  assert.equal(await proxy({ url: 'https://demo.test/en/a' }), undefined)
  cleanup()
})

test('metadata mirrors resolveSeo into the Next shape', async () => {
  const { seo, cleanup } = runtime()
  await seo.handlers.POST(post('/api/seo/sync', snapshot), ctx('sync'))
  const m = await seo.metadata({ path: '/en/a', lang: 'en' })
  assert.equal(m.title, 'A page | Demo')
  assert.equal(m.alternates!.canonical, 'https://demo.test/en/a')
  assert.equal(m.robots!.index, true)
  cleanup()
})
