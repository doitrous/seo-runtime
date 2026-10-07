import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SeoStore } from '../store.ts'
import type { Settings, Snapshot, SnapshotPage, StoredArticle, StoredRedirect } from '../types.ts'
import { normalizePath } from '../types.ts'
import { canonicalLocale, isLead, localeOf, withVersionDefaults } from '../locale.ts'

export type Dialect = 'sqlite' | 'postgres' | 'mysql'

/** A ten-line adapter over better-sqlite3, pg or mysql2 — the site writes it, the package uses it. */
export type SqlDriver = {
  dialect: Dialect
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>
}

const here = dirname(fileURLToPath(import.meta.url))

export function migrationSql(dialect: Dialect): string {
  // dist/stores/sql.js sits one level below dist/, and src/migrations ships in the package files.
  for (const candidate of [join(here, '../migrations', `${dialect}.sql`), join(here, '../../src/migrations', `${dialect}.sql`)]) {
    try { return readFileSync(candidate, 'utf8') } catch { /* try the next location */ }
  }
  throw new Error(`no migration for dialect ${dialect}`)
}

const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)

export class SqlStore implements SeoStore {
  private driver: SqlDriver
  constructor(driver: SqlDriver) { this.driver = driver }

  /** `?` placeholders are rewritten for postgres; sqlite and mysql take them as they are. */
  private q(sql: string, params: unknown[] = []) {
    let i = 0
    const text = this.driver.dialect === 'postgres' ? sql.replace(/\?/g, () => `$${++i}`) : sql
    return this.driver.query(text, params)
  }

  async migrate(): Promise<void> {
    // A 0.1.x articles table (keyed by (external_id, lang), no locale) is upgraded first: the
    // create script below declares an index on `locale`, which would fail against the old table.
    if (await this.needsLocaleUpgrade()) {
      for (const statement of LOCALE_UPGRADE[this.driver.dialect]) await this.q(statement)
    }
    for (const statement of migrationSql(this.driver.dialect).split(';')) {
      if (statement.trim()) await this.q(statement)
    }
  }

  /** True when `seo_runtime_articles` exists without the 0.2.0 `locale` column. */
  private async needsLocaleUpgrade(): Promise<boolean> {
    try { await this.q('SELECT external_id FROM seo_runtime_articles WHERE 1 = 0') } catch { return false }   // no table yet
    try { await this.q('SELECT locale FROM seo_runtime_articles WHERE 1 = 0'); return false } catch { return true }
  }

  /** Every page column, in one place, so the SELECT list and the row mapper cannot drift apart. */
  static PAGE_COLUMNS = 'page_key, type, lang, path, group_key, title, updated_at, seo'
  private static toPage(p: Record<string, unknown>): SnapshotPage {
    return {
      key: String(p.page_key), type: String(p.type), lang: String(p.lang), path: String(p.path),
      group: String(p.group_key), title: String(p.title), updatedAt: String(p.updated_at), seo: json(p.seo),
    }
  }

  /** Sync and the health counts only — no render path calls this. */
  async getSnapshot(): Promise<Snapshot | null> {
    const [state] = await this.q('SELECT version, site_slug, settings FROM seo_runtime_state WHERE id = 1')
    if (!state) return null
    const pages = await this.q(`SELECT ${SqlStore.PAGE_COLUMNS} FROM seo_runtime_pages`)
    const redirects = await this.q('SELECT source, destination, type, active FROM seo_runtime_redirects')
    return {
      version: Number(state.version), siteSlug: String(state.site_slug), settings: json(state.settings),
      pages: pages.map(SqlStore.toPage),
      redirects: redirects.map((r) => ({ source: String(r.source), destination: String(r.destination), type: Number(r.type), active: !!r.active })),
    }
  }

  /** One row, not the whole store: this is what `resolveSeo` reads on every render. */
  async getSettings(): Promise<Settings | null> {
    const [state] = await this.q('SELECT settings FROM seo_runtime_state WHERE id = 1')
    return state ? (json(state.settings) as Settings) : null
  }

  async putSnapshot(s: Snapshot): Promise<void> {
    // Replace, never merge: the snapshot is the whole truth, and a page dropped by the hub must
    // disappear here too.
    await this.q('DELETE FROM seo_runtime_pages')
    await this.q('DELETE FROM seo_runtime_redirects')
    await this.q('DELETE FROM seo_runtime_state')
    await this.q('INSERT INTO seo_runtime_state (id, version, site_slug, settings, last_sync_at) VALUES (1, ?, ?, ?, ?)',
      [s.version, s.siteSlug, JSON.stringify(s.settings), new Date().toISOString()])
    for (const p of s.pages) {
      await this.q('INSERT INTO seo_runtime_pages (page_key, type, lang, path, group_key, title, updated_at, seo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [p.key, p.type, p.lang, normalizePath(p.path), p.group, p.title, p.updatedAt, JSON.stringify(p.seo)])
    }
    for (const r of s.redirects) {
      await this.q('INSERT INTO seo_runtime_redirects (source, destination, type, active, hits) VALUES (?, ?, ?, ?, 0)',
        [normalizePath(r.source), r.destination, r.type, r.active ? 1 : 0])
    }
  }

  async getPage(path: string, lang: string): Promise<SnapshotPage | null> {
    const [p] = await this.q(`SELECT ${SqlStore.PAGE_COLUMNS} FROM seo_runtime_pages WHERE path = ? AND lang = ?`, [normalizePath(path), lang])
    return p ? SqlStore.toPage(p) : null
  }

  async listGroup(groupKey: string): Promise<SnapshotPage[]> {
    if (!groupKey) return []
    const rows = await this.q(`SELECT ${SqlStore.PAGE_COLUMNS} FROM seo_runtime_pages WHERE group_key = ?`, [groupKey])
    return rows.map(SqlStore.toPage)
  }

  async getRedirect(path: string): Promise<StoredRedirect | null> {
    const [r] = await this.q('SELECT source, destination, type, active FROM seo_runtime_redirects WHERE source = ?', [normalizePath(path)])
    if (!r || !r.active) return null
    return { source: String(r.source), destination: String(r.destination), type: Number(r.type), active: true }
  }

  async listArticles(lang?: string): Promise<StoredArticle[]> {
    const rows = lang
      ? await this.q('SELECT * FROM seo_runtime_articles WHERE lang = ?', [lang])
      : await this.q('SELECT * FROM seo_runtime_articles')
    return this.toArticles(rows)
  }

  async listArticleVersions(externalId: number): Promise<StoredArticle[]> {
    return this.toArticles(await this.q('SELECT * FROM seo_runtime_articles WHERE external_id = ?', [externalId]))
  }

  private toArticles(rows: Record<string, unknown>[]): StoredArticle[] {
    return rows.map((r) => withVersionDefaults({
      externalId: Number(r.external_id), lang: String(r.lang), slug: String(r.slug), title: String(r.title),
      metaTitle: String(r.meta_title), metaDescription: String(r.meta_description),
      bodyMd: String(r.body_md), bodyHtml: String(r.body_html),
      faq: json(r.faq), schemaJsonld: json(r.schema_jsonld),
      imageUrl: (r.image_url as string) ?? null, imageAlt: (r.image_alt as string) ?? null,
      authorName: (r.author_name as string) ?? null, authorCredentials: (r.author_credentials as string) ?? null,
      references: json(r.refs), og: json(r.og), extra: json(r.extra ?? '{}'),
      publishedAt: String(r.published_at), updatedAt: String(r.updated_at),
      locale: r.locale == null || r.locale === '' ? String(r.lang) : String(r.locale),
      lead: r.is_lead == null ? true : Number(r.is_lead) !== 0 && r.is_lead !== false,
      hreflang: json(r.hreflang ?? '{}') ?? {},
    }))
  }

  async findArticleBySlug(langOrLocale: string, slug: string): Promise<StoredArticle | null> {
    const key = String(langOrLocale ?? '')
    // A plain-language lead first (case-insensitive, `pt-BR` as a language), then the locale.
    const leads = this.toArticles(await this.q('SELECT * FROM seo_runtime_articles WHERE slug = ? AND is_lead = 1 AND LOWER(lang) = ?', [slug, key.toLowerCase()]))
    if (leads.length) return leads[0]
    const rows = await this.q('SELECT * FROM seo_runtime_articles WHERE locale = ? AND slug = ?', [canonicalLocale(key), slug])
    return rows.length ? this.toArticles(rows)[0] : null
  }

  async upsertArticle(input: StoredArticle): Promise<StoredArticle> {
    const a = withVersionDefaults(input)
    const locale = localeOf(a)
    const lead = isLead(a)
    let existing: Record<string, unknown> | undefined
    if (lead) {
      // The lead replaces its language's lead whatever that row's locale was (a 0.1.x row keyed
      // by language included), and absorbs a non-lead row already stored under its locale.
      await this.q('DELETE FROM seo_runtime_articles WHERE external_id = ? AND locale = ? AND is_lead = 0', [a.externalId, locale]);
      [existing] = await this.q('SELECT published_at, locale FROM seo_runtime_articles WHERE external_id = ? AND lang = ? AND is_lead = 1', [a.externalId, a.lang])
    } else {
      [existing] = await this.q('SELECT published_at, locale FROM seo_runtime_articles WHERE external_id = ? AND locale = ? AND is_lead = 0', [a.externalId, locale])
    }
    const publishedAt = existing ? String(existing.published_at) : a.publishedAt
    const values = [a.slug, a.title, a.metaTitle, a.metaDescription, a.bodyMd, a.bodyHtml,
      JSON.stringify(a.faq), JSON.stringify(a.schemaJsonld), a.imageUrl, a.imageAlt,
      a.authorName, a.authorCredentials, JSON.stringify(a.references), JSON.stringify(a.og),
      JSON.stringify(a.extra ?? {}), a.updatedAt, locale, JSON.stringify(a.hreflang ?? {})]
    if (existing) {
      await this.q(`UPDATE seo_runtime_articles SET slug = ?, title = ?, meta_title = ?, meta_description = ?, body_md = ?, body_html = ?,
        faq = ?, schema_jsonld = ?, image_url = ?, image_alt = ?, author_name = ?, author_credentials = ?, refs = ?, og = ?, extra = ?, updated_at = ?,
        locale = ?, hreflang = ?
        WHERE external_id = ? AND locale = ?`, [...values, a.externalId, String(existing.locale)])
    } else {
      await this.q(`INSERT INTO seo_runtime_articles (slug, title, meta_title, meta_description, body_md, body_html,
        faq, schema_jsonld, image_url, image_alt, author_name, author_credentials, refs, og, extra, updated_at, locale, hreflang,
        external_id, lang, published_at, is_lead)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, a.externalId, a.lang, publishedAt, lead ? 1 : 0])
    }
    return { ...a, publishedAt }
  }

  async incrementHit(source: string): Promise<void> {
    await this.q('UPDATE seo_runtime_redirects SET hits = hits + 1 WHERE source = ?', [normalizePath(source)])
  }

  async peekHits(): Promise<{ source: string; hits: number }[]> {
    const rows = await this.q('SELECT source, hits FROM seo_runtime_redirects WHERE hits > 0')
    return rows.map((r) => ({ source: String(r.source), hits: Number(r.hits) }))
  }

  async takeHits(reported: { source: string; hits: number }[]): Promise<void> {
    for (const { source, hits } of reported) {
      await this.q('UPDATE seo_runtime_redirects SET hits = CASE WHEN hits > ? THEN hits - ? ELSE 0 END WHERE source = ?',
        [hits, hits, normalizePath(source)])
    }
  }

  async lastSyncAt(): Promise<string | null> {
    const [state] = await this.q('SELECT last_sync_at FROM seo_runtime_state WHERE id = 1')
    // Postgres drivers hand a timestamptz back as a Date; MySQL/SQLite store the ISO text as-is.
    const v = state?.last_sync_at
    return v == null ? null : v instanceof Date ? v.toISOString() : String(v)
  }
}

/**
 * 0.1.x → 0.2.0 (per-country pages): add `locale` (backfilled with `lang`), `is_lead` (every 0.1.x
 * row was the only version of its language, so 1) and `hreflang`, and re-key the table from
 * (external_id, lang) to (external_id, locale). Existing rows keep their language URL. Runs once,
 * from `migrate()`, only when the table exists without a `locale` column.
 */
const ARTICLE_COLUMNS_V1 = 'external_id, lang, slug, title, meta_title, meta_description, body_md, body_html, faq, schema_jsonld, ' +
  'image_url, image_alt, author_name, author_credentials, refs, og, extra, published_at, updated_at'
const LOCALE_UPGRADE: Record<Dialect, string[]> = {
  // SQLite cannot change a primary key in place: rename, let the create script build the 0.2.0
  // table, copy, drop. The old slug index travels with the renamed table and is dropped first so
  // the create script recreates it on the new one.
  sqlite: [
    'ALTER TABLE seo_runtime_articles RENAME TO seo_runtime_articles_v1',
    'DROP INDEX IF EXISTS seo_runtime_articles_slug',
    `CREATE TABLE seo_runtime_articles (
      external_id INTEGER NOT NULL, lang TEXT NOT NULL, slug TEXT NOT NULL,
      title TEXT NOT NULL, meta_title TEXT NOT NULL DEFAULT '', meta_description TEXT NOT NULL DEFAULT '',
      body_md TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '',
      faq TEXT NOT NULL DEFAULT '[]', schema_jsonld TEXT NOT NULL DEFAULT '[]',
      image_url TEXT, image_alt TEXT, author_name TEXT, author_credentials TEXT,
      refs TEXT NOT NULL DEFAULT '[]', og TEXT NOT NULL DEFAULT '{}',
      extra TEXT NOT NULL DEFAULT '{}',
      published_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
      locale TEXT NOT NULL, is_lead INTEGER NOT NULL DEFAULT 1, hreflang TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (external_id, locale)
    )`,
    `INSERT INTO seo_runtime_articles (${ARTICLE_COLUMNS_V1}, locale, is_lead, hreflang)
      SELECT ${ARTICLE_COLUMNS_V1}, lang, 1, '{}' FROM seo_runtime_articles_v1`,
    'DROP TABLE seo_runtime_articles_v1',
  ],
  postgres: [
    'ALTER TABLE seo_runtime_articles ADD COLUMN locale text',
    'UPDATE seo_runtime_articles SET locale = lang WHERE locale IS NULL',
    'ALTER TABLE seo_runtime_articles ALTER COLUMN locale SET NOT NULL',
    'ALTER TABLE seo_runtime_articles ADD COLUMN is_lead integer NOT NULL DEFAULT 1',
    "ALTER TABLE seo_runtime_articles ADD COLUMN hreflang jsonb NOT NULL DEFAULT '{}'",
    'ALTER TABLE seo_runtime_articles DROP CONSTRAINT IF EXISTS seo_runtime_articles_pkey',
    'ALTER TABLE seo_runtime_articles ADD PRIMARY KEY (external_id, locale)',
  ],
  mysql: [
    "ALTER TABLE seo_runtime_articles ADD COLUMN locale VARCHAR(191) NOT NULL DEFAULT '', ADD COLUMN is_lead TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN hreflang JSON NULL",
    "UPDATE seo_runtime_articles SET locale = lang WHERE locale = ''",
    'ALTER TABLE seo_runtime_articles DROP PRIMARY KEY, ADD PRIMARY KEY (external_id, locale), ADD KEY seo_runtime_articles_locale_slug (locale, slug)',
  ],
}
