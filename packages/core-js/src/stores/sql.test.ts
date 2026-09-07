import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { SqlStore, migrationSql, type SqlDriver } from './sql.ts'
import { EMPTY_META, EMPTY_SETTINGS, type Snapshot, type StoredArticle } from '../types.ts'

function sqliteDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:')
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

const snapshot: Snapshot = {
  version: 3, siteSlug: 'x', settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://x.com' } },
  pages: [{
    key: 'k', type: 'page', lang: 'en', path: '/en/a', group: 'k', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z',
    seo: { seoTitle: 'T', metaDescription: 'D', canonical: '', index: true, follow: true, includeInSitemap: true, priority: 0.5, og: EMPTY_META, twitter: EMPTY_META, schemaType: '', structuredData: [], faq: [] },
  }],
  redirects: [{ source: '/old', destination: '/en/a', type: 301, active: true }],
}
const article: StoredArticle = {
  externalId: 9, lang: 'en', slug: 'a', title: 'A', metaTitle: 'A', metaDescription: 'D', bodyMd: '#', bodyHtml: '<p></p>',
  faq: [], schemaJsonld: [], imageUrl: null, imageAlt: null, authorName: null, authorCredentials: null,
  references: [], og: EMPTY_META, extra: { reviewer: { name: 'Dr B' } },
  publishedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

async function fresh() {
  const store = new SqlStore(sqliteDriver())
  await store.migrate()
  return store
}

test('the migration is idempotent', async () => {
  const store = await fresh()
  await store.migrate()
  assert.equal(await store.getSnapshot(), null)
})

test('a snapshot round-trips through the store', async () => {
  const store = await fresh()
  await store.putSnapshot(snapshot)
  const back = await store.getSnapshot()
  assert.equal(back!.version, 3)
  assert.equal(back!.pages[0].seo.seoTitle, 'T')
})

test('pages and redirects are queryable by path', async () => {
  const store = await fresh()
  await store.putSnapshot(snapshot)
  assert.equal((await store.getPage('/en/a', 'en'))!.title, 'A')
  assert.equal((await store.getPage('/en/a', 'en'))!.key, 'k')   // page_key round-trips as `key`
  assert.equal(await store.getPage('/en/a', 'ar'), null)
  assert.equal((await store.getRedirect('/old'))!.destination, '/en/a')
  assert.equal(await store.getRedirect('/nope'), null)
})

test('the group query returns the translations resolveSeo needs', async () => {
  const store = await fresh()
  const ar = { ...snapshot.pages[0], lang: 'ar', path: '/ar/a' }
  await store.putSnapshot({ ...snapshot, pages: [snapshot.pages[0], ar] })
  assert.deepEqual((await store.listGroup('k')).map((p) => p.lang).sort(), ['ar', 'en'])
  assert.deepEqual(await store.listGroup(''), [])
})

test('the settings row is readable without loading the whole store', async () => {
  const store = await fresh()
  await store.putSnapshot(snapshot)
  assert.deepEqual((await store.getSettings())!.baseUrls, { en: 'https://x.com' })
})

// A column literally named `key` — bare or backtick-quoted, immediately followed by a type —
// is what MySQL rejects (KEY is reserved there); "PRIMARY KEY (...)" and the inline MySQL
// index syntax "KEY name (col)" are the SQL keyword, not a column, and must not trip this.
test('no SQL statement names a column `key` — MySQL would reject it', () => {
  for (const d of ['sqlite', 'postgres', 'mysql'] as const) {
    assert.doesNotMatch(migrationSql(d), /(^|[\s(,])`?key`?\s+(text|integer|varchar|json|int)\b/i, d)
  }
})

test('a re-synced snapshot replaces the previous pages rather than accumulating', async () => {
  const store = await fresh()
  await store.putSnapshot(snapshot)
  await store.putSnapshot({ ...snapshot, version: 4, pages: [] })
  assert.equal(await store.getPage('/en/a', 'en'), null)
  assert.equal((await store.getSnapshot())!.version, 4)
})

test('articles upsert on (external id, language), keep their first published date and their extras', async () => {
  const store = await fresh()
  await store.upsertArticle(article)
  await store.upsertArticle({ ...article, title: 'A2', publishedAt: '2027-01-01T00:00:00.000Z' })
  const rows = await store.listArticles()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'A2')
  assert.equal(rows[0].publishedAt, '2026-09-01T00:00:00.000Z')
  assert.deepEqual(rows[0].extra, { reviewer: { name: 'Dr B' } })
  assert.equal((await store.listArticles('ar')).length, 0)
  assert.equal((await store.findArticleBySlug('en', 'a'))!.externalId, 9)
  assert.equal(await store.findArticleBySlug('en', 'nope'), null)
})

test('hits accumulate, survive a read, and clear only by what was acknowledged', async () => {
  const store = await fresh()
  // incrementHit only counts known redirects, so the snapshot has to be in place first.
  await store.putSnapshot({ ...snapshot, redirects: [
    { source: '/old', destination: '/en/a', type: 301, active: true },
    { source: '/other', destination: '/en/a', type: 301, active: true },
  ] })
  await store.incrementHit('/old')
  await store.incrementHit('/old')
  await store.incrementHit('/other')
  const hits = (await store.peekHits()).sort((a, b) => a.source.localeCompare(b.source))
  assert.deepEqual(hits, [{ source: '/old', hits: 2 }, { source: '/other', hits: 1 }])
  assert.equal((await store.peekHits()).length, 2)   // reading does not reset
  await store.takeHits(hits)
  assert.deepEqual(await store.peekHits(), [])
})

test('every dialect ships a migration and they name the same four tables', () => {
  for (const d of ['sqlite', 'postgres', 'mysql'] as const) {
    const sql = migrationSql(d)
    for (const t of ['seo_runtime_state', 'seo_runtime_pages', 'seo_runtime_redirects', 'seo_runtime_articles'])
      assert.match(sql, new RegExp(t))
  }
})
