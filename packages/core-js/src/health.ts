import type { SeoStore } from './store.ts'
import { readConfig, warnMissingSlug } from './config.ts'
import { storeFailures } from './resolve.ts'

/** The hub rejects a health body with more redirect entries than this (400). */
export const MAX_REDIRECT_HITS = 1000

export type HealthBody = {
  version: string; siteSlug: string; lastSyncAt: string | null; snapshotVersion: number
  counts: { pages: number; redirects: number; articles: number; storeFailures: number }
  redirectHits: { source: string; hits: number }[]
  /** True when the share block (entities.ts's `shareBlockHtml`) is wired into this site's content pages. */
  share: boolean
  /**
   * Capabilities the hub may rely on. `localeUrls` (0.2.0, hub contract 1.20.0): this runtime
   * serves per-country versions of one language (`/ar-ae/blog/x`) and computes their hreflang,
   * so the hub may send several items per language once the site's `localeUrls` flag is on.
   */
  features: string[]
}

/** What this runtime advertises on the health ping (`features`). */
export const RUNTIME_FEATURES: readonly string[] = ['localeUrls']

/**
 * Read-only. It does NOT drain the hit counters — `sendHealth` does that, and only after the hub
 * has answered 2xx, so a ping that never arrives loses nothing. `GET /api/seo/health` therefore
 * has no side effect at all, which is what lets it be a plain authenticated read.
 *
 * `share` defaults to true: every package appends the share block to the help/tool/author pages
 * it renders unless the integrator explicitly opts out (`opts.share === false`), so a caller that
 * never passes anything here is reporting the common case, not a stretch.
 */
export async function healthPayload(store: SeoStore, version: string, slug: string, share = true): Promise<HealthBody> {
  const snapshot = await store.getSnapshot()
  const articles = await store.listArticles()
  const hits = await store.peekHits()
  return {
    version, siteSlug: slug || snapshot?.siteSlug || '', lastSyncAt: await store.lastSyncAt(),
    snapshotVersion: snapshot?.version ?? 0,
    counts: {
      pages: snapshot?.pages.length ?? 0, redirects: snapshot?.redirects.length ?? 0,
      articles: articles.length,
      // Swallowed store errors since boot. Rendering never throws, but silence would hide a
      // permanently broken store until somebody noticed a blank <title>.
      storeFailures: storeFailures(),
    },
    // The hub caps the list; the busiest sources go first and the rest wait for the next ping
    // (takeHits drains only what was reported).
    redirectHits: hits.filter((h) => Number.isFinite(h.hits) && h.hits > 0)
      .sort((a, b) => b.hits - a.hits).slice(0, MAX_REDIRECT_HITS),
    share,
    features: [...RUNTIME_FEATURES],
  }
}

/**
 * Hourly-or-whatever-cadence-startSync-uses ping. The counters are drained only after the hub
 * answers 2xx: draining first would throw the deltas away every time the hub is unreachable,
 * which is exactly when they matter.
 */
export async function sendHealth(store: SeoStore, version: string, cfg = readConfig(), share = true): Promise<boolean> {
  if (!cfg.hubUrl || !cfg.secret) return false
  try {
    const body = await healthPayload(store, version, cfg.slug, share)
    if (!body.siteSlug) { warnMissingSlug(); return false }   // nothing to address the hub with yet
    const res = await fetch(`${cfg.hubUrl}/api/runtime/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) return false
    // Drain exactly what was reported. Hits counted while the request was in flight survive.
    await store.takeHits(body.redirectHits)
    return true
  } catch {
    return false
  }
}
