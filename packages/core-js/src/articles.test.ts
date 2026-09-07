import assert from 'node:assert/strict'
import test from 'node:test'
import { ingestArticles, toStoredArticles, validatePayload, type HubPayload } from './articles.ts'
import type { StoredArticle } from './types.ts'

const payload = (): HubPayload => ({
  externalId: 9,
  author: { name: 'Dr A', credentials: 'MD' },
  image: { url: 'https://x.com/a.png', alt: 'a hair transplant clinic room' },
  reviewer: { name: 'Dr B', credentials: 'MD', bio: '' },
  reviewedAt: { medical: '2026-09-01T00:00:00.000Z', seo: '2026-09-01T00:00:00.000Z' },
  cta: { text: 'Book', url: 'https://x.com/book' },
  plannedUpdateAt: '2027-09-01T00:00:00.000Z',
  articles: [{
    lang: 'en', title: 'Hair transplant in Egypt', slug: 'hair-transplant-egypt',
    metaTitle: 'Hair transplant in Egypt', metaDescription: 'What it costs.',
    bodyMd: '# Hair transplant in Egypt\n\nThe first paragraph.', faq: [{ q: 'Q', a: 'A' }],
    schemaJsonld: [{ '@context': 'https://schema.org', '@type': 'BlogPosting' }], hreflang: { en: '/en/blog/hair-transplant-egypt' },
    introduction: 'A lede.', secondaryKeywords: ['cost'], searchIntent: 'informational',
    og: { title: 'OG', description: 'OGD' }, references: [{ title: 'A study', url: 'https://pubmed.gov/1' }],
    sections: {},
  }],
})

test('a full spec-1 payload validates', () => {
  const v = validatePayload(payload())
  assert.ok('payload' in v)
})

test('the required fields are named in the error', () => {
  assert.deepEqual(validatePayload({ articles: [] }), { error: 'invalid externalId' })
  assert.deepEqual(validatePayload({ externalId: 9, articles: [] }), { error: 'invalid articles' })
  const bad = { ...payload(), articles: [{ ...payload().articles[0], slug: 'Not A Slug' }] }
  assert.deepEqual(validatePayload(bad), { error: 'invalid articles[0].slug' })
  for (const slug of ['a/b', '../etc', 'a?b', 'a#b', 'x'.repeat(192), '']) {
    const p = { ...payload(), articles: [{ ...payload().articles[0], slug }] }
    assert.deepEqual(validatePayload(p), { error: 'invalid articles[0].slug' }, slug)
  }
  const noTitle = { ...payload(), articles: [{ ...payload().articles[0], title: '  ' }] }
  assert.deepEqual(validatePayload(noTitle), { error: 'invalid articles[0].title' })
})

test('a non-ASCII slug is accepted — Aspects serves Arabic article URLs', () => {
  const p = { ...payload(), articles: [{ ...payload().articles[0], lang: 'ar', slug: 'زراعة-الشعر' }] }
  assert.ok('payload' in validatePayload(p))
})

test('spec-1 fields are optional, so an older hub still validates', () => {
  const p = payload()
  delete (p.articles[0] as Record<string, unknown>).introduction
  delete (p as Record<string, unknown>).reviewer
  assert.ok('payload' in validatePayload(p))
})

test('unsupported languages are skipped, not rejected', () => {
  const p = payload()
  p.articles.push({ ...p.articles[0], lang: 'de' })
  const { skipped, articles } = toStoredArticles(p, ['en', 'ar'])
  assert.deepEqual(skipped, ['de'])
  assert.equal(articles.length, 1)
})

test('the stored article carries rendered HTML, a derived meta description and the image', () => {
  const p = payload()
  p.articles[0].metaDescription = ''
  const [a] = toStoredArticles(p, ['en']).articles
  assert.match(a.bodyHtml, /<p>The first paragraph\.<\/p>/)
  assert.doesNotMatch(a.bodyHtml, /<h1>/)
  assert.equal(a.metaDescription, 'A lede.')
  assert.equal(a.imageUrl, 'https://x.com/a.png')
  assert.equal(a.authorName, 'Dr A')
  assert.deepEqual(a.references, [{ title: 'A study', url: 'https://pubmed.gov/1' }])
  assert.equal(a.og.title, 'OG')
})

test('with no introduction the meta description falls back to the first paragraph', () => {
  const p = payload()
  p.articles[0].metaDescription = ''
  delete (p.articles[0] as Record<string, unknown>).introduction
  const [a] = toStoredArticles(p, ['en']).articles
  assert.equal(a.metaDescription, 'The first paragraph.')
})

const fakeStore = () => {
  const rows: StoredArticle[] = []
  return {
    rows,
    findArticleBySlug: async (lang: string, slug: string) =>
      rows.find((r) => r.lang === lang && r.slug === slug) ?? null,
    upsertArticle: async (a: StoredArticle) => {
      const i = rows.findIndex((r) => r.externalId === a.externalId && r.lang === a.lang)
      if (i >= 0) rows[i] = a; else rows.push(a)
      return a
    },
  } as never
}

const opts = { supported: ['en', 'ar'], urlFor: (lang: string, slug: string) => `https://x.com/${lang}/blog/${slug}` }

test('ingest returns results with absolute URLs and the skipped languages', async () => {
  const store = fakeStore()
  const out = await ingestArticles(store, payload(), opts)
  assert.equal(out.status, 200)
  assert.deepEqual(out.body, {
    results: [{ lang: 'en', remoteId: '9:en', remoteUrl: 'https://x.com/en/blog/hair-transplant-egypt' }],
    skipped: [],
  })
})

test('a re-ingest updates rather than duplicating', async () => {
  const store = fakeStore()
  const rows = (store as unknown as { rows: StoredArticle[] }).rows
  await ingestArticles(store, payload(), opts)
  assert.equal(rows.length, 1)
  const p = payload()
  p.articles[0].title = 'Hair transplant in Egypt, 2027'
  await ingestArticles(store, p, opts)
  // One row, and it is the NEW one — a count of 1 alone is also true of a first ingest, so the
  // assertion has to look at the content.
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Hair transplant in Egypt, 2027')
})

test('another job reusing a live slug is a 409, not a second article at the same URL', async () => {
  const store = fakeStore()
  await ingestArticles(store, payload(), opts)
  const other = { ...payload(), externalId: 10 }
  const out = await ingestArticles(store, other, opts)
  assert.equal(out.status, 409)
  assert.deepEqual(out.body, { error: 'slug_taken', slug: 'hair-transplant-egypt', lang: 'en' })
  assert.equal((store as unknown as { rows: StoredArticle[] }).rows.length, 1)
})

test('the stored article keeps the spec-1 fields that have no column', async () => {
  const store = fakeStore()
  await ingestArticles(store, payload(), opts)
  const [row] = (store as unknown as { rows: StoredArticle[] }).rows
  assert.equal((row.extra.reviewer as { name: string }).name, 'Dr B')
  assert.equal((row.extra.cta as { text: string }).text, 'Book')
  assert.deepEqual(row.extra.secondaryKeywords, ['cost'])
  assert.equal(row.extra.plannedUpdateAt, '2027-09-01T00:00:00.000Z')
})

test('an invalid payload is a 400 naming the field', async () => {
  const out = await ingestArticles(fakeStore(), { externalId: 'nine' }, opts)
  assert.equal(out.status, 400)
  assert.deepEqual(out.body, { error: 'invalid externalId' })
})

test('a payload with no supported language is a 400', async () => {
  const p = payload()
  p.articles[0].lang = 'de'
  const out = await ingestArticles(fakeStore(), p, opts)
  assert.equal(out.status, 400)
  assert.deepEqual(out.body, { error: 'no supported languages' })
})

test('the onArticle hook takes over storage entirely', async () => {
  let seen: HubPayload | null = null
  const out = await ingestArticles(fakeStore(), payload(), {
    ...opts,
    onArticle: async (p) => { seen = p; return { results: [{ lang: 'en', remoteId: 'cms-1', remoteUrl: 'https://x.com/en/articles/x' }], skipped: [] } },
  })
  assert.equal(seen!.externalId, 9)
  assert.equal(out.status, 200)
  assert.deepEqual(out.body, { results: [{ lang: 'en', remoteId: 'cms-1', remoteUrl: 'https://x.com/en/articles/x' }], skipped: [] })
})

test('a hook can set the status and add its own keys — Aspects publication gate', async () => {
  const out = await ingestArticles(fakeStore(), payload(), {
    ...opts,
    onArticle: async () => ({ status: 422, error: 'publication_gate', message: 'missing medical review', results: [], skipped: [] }),
  })
  assert.equal(out.status, 422)
  assert.deepEqual(out.body, { error: 'publication_gate', message: 'missing medical review', results: [], skipped: [] })
})

test('a hook that throws a duplicate-key error is a 409, and anything else a clean 500', async () => {
  const dup = await ingestArticles(fakeStore(), payload(), {
    ...opts, onArticle: async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }) },
  })
  assert.equal(dup.status, 409)
  assert.deepEqual(dup.body, { error: 'slug_taken' })

  const boom = await ingestArticles(fakeStore(), payload(), {
    ...opts, onArticle: async () => { throw new Error('supabase down') },
  })
  assert.equal(boom.status, 500)
  assert.deepEqual(boom.body, { error: 'article_hook_failed', message: 'supabase down' })
})
