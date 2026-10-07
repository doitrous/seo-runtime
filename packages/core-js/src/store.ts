import type { Settings, Snapshot, SnapshotPage, StoredArticle, StoredRedirect } from './types.ts'

/**
 * Everything a runtime needs from persistence. Sites that already have a database driver
 * implement this over it (Prisma, Supabase, Eloquent); the package ships a JSON-file store
 * for demos and a SQL store for better-sqlite3 / pg / mysql2.
 */
export interface SeoStore {
  /** Sync and the health counts only. No render path calls this — see `getPage`/`listGroup`. */
  getSnapshot(): Promise<Snapshot | null>
  putSnapshot(snapshot: Snapshot): Promise<void>
  /** The stored settings alone — one row, not the whole snapshot. `resolveSeo` reads this. */
  getSettings(): Promise<Settings | null>
  /** The one page lookup `resolveSeo` makes. `path` is already normalized by the caller. */
  getPage(path: string, lang: string): Promise<SnapshotPage | null>
  /** The page's translations, for `alternates`. Empty `groupKey` returns `[]`. */
  listGroup(groupKey: string): Promise<SnapshotPage[]>
  getRedirect(path: string): Promise<StoredRedirect | null>
  listArticles(lang?: string): Promise<StoredArticle[]>
  /**
   * Article lookup, and slug-collision detection for the 409. Returns the row whatever its
   * `externalId`. `langOrLocale` is either a plain language (`ar`) — which resolves to that
   * language's **lead** version, the one at `articlePath(lang, slug)` — or a locale (`ar-AE`,
   * `ar-ae`), which resolves to the version stored under that locale. A plain-language lead is
   * tried first, so a site whose `supported` list carries a region-coded language (`pt-BR`) still
   * finds it by that code.
   *
   * A store written for 0.1.x that only understands a plain language keeps working for every
   * payload without `locale`; it must learn locales before the hub's `localeUrls` is turned on.
   */
  findArticleBySlug(langOrLocale: string, slug: string): Promise<StoredArticle | null>
  /**
   * Keyed by (externalId, locale) — `localeOf(article)`, which is `lang` for a row with no
   * locale. A **lead** (`isLead(article)`) instead replaces the existing lead of its language for
   * that externalId whatever its stored locale, so a 0.1.x row keyed by language is updated in
   * place (never duplicated) when the hub starts sending `locale`; any non-lead row of that
   * externalId already stored under the lead's locale is removed.
   */
  upsertArticle(article: StoredArticle): Promise<StoredArticle>
  /**
   * Every stored version of one externalId. Optional: when a store omits it the runtime filters
   * `listArticles()` instead.
   */
  listArticleVersions?(externalId: number): Promise<StoredArticle[]>
  /** Counts a redirect hit locally; reported as a delta by the next health ping. */
  incrementHit(source: string): Promise<void>
  /** The current deltas, without resetting. `GET /api/seo/health` must not mutate. */
  peekHits(): Promise<{ source: string; hits: number }[]>
  /**
   * Subtracts exactly what the hub acknowledged. Called only after a 2xx, and it subtracts rather
   * than zeroing so hits counted while the request was in flight are not thrown away.
   */
  takeHits(reported: { source: string; hits: number }[]): Promise<void>
  /** ISO timestamp of the last applied snapshot, or null. Reported by the health ping. */
  lastSyncAt(): Promise<string | null>
}
