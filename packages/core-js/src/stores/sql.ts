import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SeoStore } from '../store.ts'
import type { Settings, Snapshot, SnapshotPage, StoredArticle, StoredRedirect } from '../types.ts'
import { normalizePath } from '../types.ts'

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
    for (const statement of migrationSql(this.driver.dialect).split(';')) {
      if (statement.trim()) await this.q(statement)
    }
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

  private toArticles(rows: Record<string, unknown>[]): StoredArticle[] {
    return rows.map((r) => ({
      externalId: Number(r.external_id), lang: String(r.lang), slug: String(r.slug), title: String(r.title),
      metaTitle: String(r.meta_title), metaDescription: String(r.meta_description),
      bodyMd: String(r.body_md), bodyHtml: String(r.body_html),
      faq: json(r.faq), schemaJsonld: json(r.schema_jsonld),
      imageUrl: (r.image_url as string) ?? null, imageAlt: (r.image_alt as string) ?? null,
      authorName: (r.author_name as string) ?? null, authorCredentials: (r.author_credentials as string) ?? null,
      references: json(r.refs), og: json(r.og), extra: json(r.extra ?? '{}'),
      publishedAt: String(r.published_at), updatedAt: String(r.updated_at),
    }))
  }

  async findArticleBySlug(lang: string, slug: string): Promise<StoredArticle | null> {
    const rows = await this.q('SELECT * FROM seo_runtime_articles WHERE lang = ? AND slug = ?', [lang, slug])
    return rows.length ? this.toArticles(rows)[0] : null
  }

  async upsertArticle(a: StoredArticle): Promise<StoredArticle> {
    const [existing] = await this.q('SELECT published_at FROM seo_runtime_articles WHERE external_id = ? AND lang = ?', [a.externalId, a.lang])
    const publishedAt = existing ? String(existing.published_at) : a.publishedAt
    const values = [a.slug, a.title, a.metaTitle, a.metaDescription, a.bodyMd, a.bodyHtml,
      JSON.stringify(a.faq), JSON.stringify(a.schemaJsonld), a.imageUrl, a.imageAlt,
      a.authorName, a.authorCredentials, JSON.stringify(a.references), JSON.stringify(a.og),
      JSON.stringify(a.extra ?? {}), a.updatedAt]
    if (existing) {
      await this.q(`UPDATE seo_runtime_articles SET slug = ?, title = ?, meta_title = ?, meta_description = ?, body_md = ?, body_html = ?,
        faq = ?, schema_jsonld = ?, image_url = ?, image_alt = ?, author_name = ?, author_credentials = ?, refs = ?, og = ?, extra = ?, updated_at = ?
        WHERE external_id = ? AND lang = ?`, [...values, a.externalId, a.lang])
    } else {
      await this.q(`INSERT INTO seo_runtime_articles (slug, title, meta_title, meta_description, body_md, body_html,
        faq, schema_jsonld, image_url, image_alt, author_name, author_credentials, refs, og, extra, updated_at, external_id, lang, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, a.externalId, a.lang, publishedAt])
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
