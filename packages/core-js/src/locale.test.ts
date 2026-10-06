import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  articleHreflang, articleVersionPath, canonicalLocale, defaultArticleLocalePath, isLocaleCode,
  langOfLocale, localizePath, parseLocalePrefix,
} from './locale.ts'
import { getArticle, ingestArticles, validatePayload, type HubPayload } from './articles.ts'
import { sitemapEntries, sitemapXml } from './sitemap.ts'
import { healthPayload } from './health.ts'
import { JsonFileStore } from './stores/json-file.ts'
import { SqlStore, type SqlDriver } from './stores/sql.ts'
import { DEFAULT_ARTICLE_PATH, EMPTY_SETTINGS, type Snapshot, type StoredArticle } from './types.ts'
import type { SeoStore } from './store.ts'

// --- pure helpers -------------------------------------------------------------------------------

test('canonicalLocale normalises case and separator', () => {
  assert.equal(canonicalLocale('ar-ae'), 'ar-AE')
  assert.equal(canonicalLocale('AR_ae'), 'ar-AE')
  assert.equal(canonicalLocale('zh-hant-tw'), 'zh-Hant-TW')
  assert.equal(canonicalLocale('ar'), 'ar')
  assert.equal(langOfLocale('ar-AE'), 'ar')
  assert.ok(isLocaleCode('ar-ae') && !isLocaleCode('ar') && !isLocaleCode('blog'))
})

test('localizePath swaps the language segment for the lowercase locale, or prepends it', () => {
  assert.equal(localizePath('/ar/blog/x', 'ar', 'ar-AE'), '/ar-ae/blog/x')
  assert.equal(localizePath('https://x.com/ar/blog/x', 'ar', 'ar-AE'), 'https://x.com/ar-ae/blog/x')
  assert.equal(localizePath('/blog/x', 'en', 'en-US'), '/en-us/blog/x')
  assert.equal(localizePath('https://x.com/blog/x', 'en', 'en-US'), 'https://x.com/en-us/blog/x')
  assert.equal(localizePath('/blog/ar/x', 'ar', 'ar-LY'), '/blog/ar-ly/x')       // Nishany's layout
  assert.equal(localizePath('/blog/ar', 'ar', 'ar-EG'), '/ar-eg/blog/ar')        // the slug is never the language
  assert.equal(defaultArticleLocalePath(DEFAULT_ARTICLE_PATH)('ar-AE', 'x'), '/ar-ae/blog/x')
})

test('parseLocalePrefix splits a locale or a language off the path', () => {
  assert.deepEqual(parseLocalePrefix('/ar-ae/blog/x'), { segment: 'ar-ae', lang: 'ar', locale: 'ar-AE', rest: '/blog/x' })
  assert.deepEqual(parseLocalePrefix('/ar/blog/x'), { segment: 'ar', lang: 'ar', locale: null, rest: '/blog/x' })
  assert.deepEqual(parseLocalePrefix('/en-us'), { segment: 'en-us', lang: 'en', locale: 'en-US', rest: '/' })
  assert.equal(parseLocalePrefix('/blog/x'), null)
  assert.equal(parseLocalePrefix('/about', ['en', 'ar']), null)
  assert.equal(parseLocalePrefix('/fr-fr/blog/x', ['en', 'ar']), null)
  assert.equal(parseLocalePrefix('/ar-ae/blog/x', ['en', 'ar'])?.locale, 'ar-AE')
})

// --- ingest -------------------------------------------------------------------------------------

const item = (lang: string, locale: string | undefined, slug = 'x', title = `T ${locale ?? lang}`) =>
  ({ lang, ...(locale ? { locale } : {}), title, slug, bodyMd: `# ${title}\n\nBody for ${locale ?? lang}.` })
const payload = (articles: ReturnType<typeof item>[], externalId = 9): HubPayload => ({ externalId, articles })
const opts = { supported: ['en', 'ar'], urlFor: (lang: string, slug: string) => `https://x.com/${lang}/blog/${slug}` }

function sqliteDriver(db = new DatabaseSync(':memory:')): SqlDriver {
  return {
    dialect: 'sqlite',
    async query(sql, params) {
      const stmt = db.prepare(sql)
      return sql.trim().toLowerCase().startsWith('select')
        ? (stmt.all(...(params as never[])) as Record<string, unknown>[])
        : (stmt.run(...(params as never[])), [])
    },
  }
}

const stores: [string, () => Promise<SeoStore>][] = [
  ['JsonFileStore', async () => new JsonFileStore(join(mkdtempSync(join(tmpdir(), 'seo-locale-')), 'state.json'))],
  ['SqlStore(sqlite)', async () => { const s = new SqlStore(sqliteDriver()); await s.migrate(); return s }],
]

test('validatePayload accepts a matching locale and refuses one of another language', () => {
  assert.ok('payload' in validatePayload(payload([item('ar', 'ar-AE')])))
  assert.ok('payload' in validatePayload(payload([item('ar', 'ar')])))
  assert.deepEqual(validatePayload(payload([item('ar', 'en-US')])), { error: 'invalid articles[0].locale' })
  assert.deepEqual(validatePayload(payload([{ ...item('ar', undefined), locale: 7 } as never])), { error: 'invalid articles[0].locale' })
})

for (const [name, make] of stores) {
  test(`${name}: a payload without locale answers exactly as 0.1.6`, async () => {
    const store = await make()
    const out = await ingestArticles(store, payload([item('en', undefined), item('ar', undefined)]), opts)
    assert.deepEqual(out, {
      status: 200,
      body: {
        results: [
          { lang: 'en', remoteId: '9:en', remoteUrl: 'https://x.com/en/blog/x' },
          { lang: 'ar', remoteId: '9:ar', remoteUrl: 'https://x.com/ar/blog/x' },
        ],
        skipped: [],
      },
    })
    const rows = await store.listArticles()
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((r) => [r.lang, r.locale, r.lead]), [['en', 'en', true], ['ar', 'ar', true]])
  })

  test(`${name}: several locales of one language — lead keeps the language URL, the rest go under the locale`, async () => {
    const store = await make()
    const out = await ingestArticles(store, payload([
      item('en', 'en-US'), item('ar', 'ar-SA'), item('ar', 'ar-AE'), item('ar', 'ar-LY'),
    ]), opts)
    assert.equal(out.status, 200)
    assert.deepEqual((out.body as { results: unknown[] }).results, [
      { lang: 'en', locale: 'en-US', remoteId: '9:en', remoteUrl: 'https://x.com/en/blog/x' },
      { lang: 'ar', locale: 'ar-SA', remoteId: '9:ar', remoteUrl: 'https://x.com/ar/blog/x' },
      { lang: 'ar', locale: 'ar-AE', remoteId: '9:ar-AE', remoteUrl: 'https://x.com/ar-ae/blog/x' },
      { lang: 'ar', locale: 'ar-LY', remoteId: '9:ar-LY', remoteUrl: 'https://x.com/ar-ly/blog/x' },
    ])
    const rows = await store.listArticles()
    assert.equal(rows.length, 4)
    const expected = {
      'en-US': 'https://x.com/en/blog/x', en: 'https://x.com/en/blog/x',
      'ar-SA': 'https://x.com/ar/blog/x', 'ar-AE': 'https://x.com/ar-ae/blog/x', 'ar-LY': 'https://x.com/ar-ly/blog/x',
      ar: 'https://x.com/ar/blog/x', 'x-default': 'https://x.com/en/blog/x',
    }
    for (const r of rows) assert.deepEqual(r.hreflang, expected, r.locale)

    // Lookup by locale (any case) or by plain language (the lead).
    assert.equal((await getArticle(store, 'ar-ae', 'x'))?.title, 'T ar-AE')
    assert.equal((await getArticle(store, 'ar-AE', 'x'))?.title, 'T ar-AE')
    assert.equal((await getArticle(store, 'ar', 'x'))?.title, 'T ar-SA')
    assert.equal((await getArticle(store, 'en', 'x'))?.title, 'T en-US')
    // The lead lives at the language URL only; its locale URL would be a duplicate.
    assert.equal(await getArticle(store, 'ar-sa', 'x'), null)
    assert.equal(await getArticle(store, 'ar-eg', 'x'), null)
    assert.equal(await getArticle(store, 'ar', 'nope'), null)

    // Re-ingest updates every version in place.
    await ingestArticles(store, payload([item('en', 'en-US'), item('ar', 'ar-SA'), item('ar', 'ar-AE', 'x', 'New AE')]), opts)
    const again = await store.listArticles()
    assert.equal(again.length, 4)
    assert.equal(again.find((r) => r.locale === 'ar-AE')?.title, 'New AE')
    // ar-LY (not in this payload) keeps its content and still carries the full hreflang.
    assert.equal(again.find((r) => r.locale === 'ar-LY')?.hreflang?.['ar-LY'], 'https://x.com/ar-ly/blog/x')
  })

  test(`${name}: a 0.1.x row keyed by language is updated in place when locale starts arriving`, async () => {
    const store = await make()
    await ingestArticles(store, payload([item('ar', undefined, 'x', 'old')]), opts)
    await ingestArticles(store, payload([item('ar', 'ar-SA', 'x', 'new'), item('ar', 'ar-AE', 'x', 'ae')]), opts)
    const rows = await store.listArticles()
    assert.equal(rows.length, 2)
    const lead = rows.find((r) => r.lead)!
    assert.equal(lead.locale, 'ar-SA')
    assert.equal(lead.title, 'new')
    assert.equal(rows.find((r) => !r.lead)!.locale, 'ar-AE')
  })

  test(`${name}: the slug clash is checked per locale`, async () => {
    const store = await make()
    await ingestArticles(store, payload([item('ar', 'ar-SA', 'a'), item('ar', 'ar-AE', 'b')]), opts)
    // Another job: lead slug "b" is free in /ar/ (b only exists under /ar-ae/).
    const ok = await ingestArticles(store, payload([item('ar', 'ar-SA', 'b')], 10), opts)
    assert.equal(ok.status, 200)
    // ...but a non-lead ar-AE "b" for another job collides with job 9's /ar-ae/blog/b.
    const clash = await ingestArticles(store, payload([item('ar', 'ar-SA', 'c'), item('ar', 'ar-AE', 'b')], 11), opts)
    assert.equal(clash.status, 409)
    assert.deepEqual(clash.body, { error: 'slug_taken', slug: 'b', lang: 'ar', locale: 'ar-AE' })
  })

  test(`${name}: the sitemap lists one <url> per version with the full hreflang set`, async () => {
    const store = await make()
    await ingestArticles(store, payload([item('ar', 'ar-SA'), item('en', 'en-US'), item('ar', 'ar-AE')]), opts)
    const snapshot: Snapshot = { version: 1, siteSlug: 's', settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://x.com', ar: 'https://x.com' } }, pages: [], redirects: [] }
    const entries = sitemapEntries(snapshot, await store.listArticles())
    assert.deepEqual(entries.map((e) => e.loc).sort(), ['https://x.com/ar-ae/blog/x', 'https://x.com/ar/blog/x', 'https://x.com/en/blog/x'])
    for (const e of entries) {
      assert.deepEqual(e.alternates, {
        'ar-SA': 'https://x.com/ar/blog/x', 'en-US': 'https://x.com/en/blog/x', 'ar-AE': 'https://x.com/ar-ae/blog/x',
        ar: 'https://x.com/ar/blog/x', en: 'https://x.com/en/blog/x',
        // The source (first item) is x-default, even though `en` is present.
        'x-default': 'https://x.com/ar/blog/x',
      })
    }
    assert.match(sitemapXml(entries), /hreflang="ar-AE" href="https:\/\/x\.com\/ar-ae\/blog\/x"/)
  })
}

test('the 0.1.x → 0.2.0 SQLite migration backfills locale = lang and keeps old rows readable', async () => {
  const db = new DatabaseSync(':memory:')
  // The 0.1.6 articles table, as its migration created it, with one row in it.
  db.exec(`CREATE TABLE seo_runtime_articles (
    external_id INTEGER NOT NULL, lang TEXT NOT NULL, slug TEXT NOT NULL,
    title TEXT NOT NULL, meta_title TEXT NOT NULL DEFAULT '', meta_description TEXT NOT NULL DEFAULT '',
    body_md TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '',
    faq TEXT NOT NULL DEFAULT '[]', schema_jsonld TEXT NOT NULL DEFAULT '[]',
    image_url TEXT, image_alt TEXT, author_name TEXT, author_credentials TEXT,
    refs TEXT NOT NULL DEFAULT '[]', og TEXT NOT NULL DEFAULT '{}',
    extra TEXT NOT NULL DEFAULT '{}',
    published_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (external_id, lang)
  );
  CREATE INDEX IF NOT EXISTS seo_runtime_articles_slug ON seo_runtime_articles (lang, slug);
  INSERT INTO seo_runtime_articles (external_id, lang, slug, title, og, published_at, updated_at)
    VALUES (9, 'ar', 'x', 'old', '{"title":"","description":"","image":""}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`)
  const store = new SqlStore(sqliteDriver(db))
  await store.migrate()
  await store.migrate()   // idempotent after the upgrade too
  const [row] = await store.listArticles()
  assert.equal(row.locale, 'ar')
  assert.equal(row.lead, true)
  assert.deepEqual(row.hreflang, {})
  assert.equal((await store.findArticleBySlug('ar', 'x'))?.title, 'old')
  // And it now takes a second version of the same language without touching the first's URL.
  const out = await ingestArticles(store, payload([item('ar', 'ar-SA', 'x', 'new'), item('ar', 'ar-AE')]), opts)
  assert.equal(out.status, 200)
  const rows = await store.listArticles()
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.lead)?.publishedAt, '2026-01-01T00:00:00.000Z')
})

test('articleVersionPath and articleHreflang agree on the URL of every version', () => {
  const base = { externalId: 1, slug: 'x' } as StoredArticle
  const lead = { ...base, lang: 'ar', locale: 'ar-SA', lead: true }
  const ae = { ...base, lang: 'ar', locale: 'ar-AE', lead: false }
  assert.equal(articleVersionPath(lead, DEFAULT_ARTICLE_PATH), '/ar/blog/x')
  assert.equal(articleVersionPath(ae, DEFAULT_ARTICLE_PATH), '/ar-ae/blog/x')
  assert.equal(articleVersionPath(ae, DEFAULT_ARTICLE_PATH, (l, s) => `/${l}/articles/${s}`), '/ar-AE/articles/x')
  const h = articleHreflang([lead, ae], (a) => articleVersionPath(a, DEFAULT_ARTICLE_PATH))
  assert.deepEqual(h, { 'ar-SA': '/ar/blog/x', 'ar-AE': '/ar-ae/blog/x', ar: '/ar/blog/x', 'x-default': '/ar/blog/x' })
})

test('the health body advertises localeUrls', async () => {
  const store = new JsonFileStore(join(mkdtempSync(join(tmpdir(), 'seo-health-')), 'state.json'))
  const body = await healthPayload(store, '0.2.0', 'demo')
  assert.deepEqual(body.features, ['localeUrls'])
})
