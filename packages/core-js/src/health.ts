import type { SeoStore } from './store.ts'
import { readConfig } from './config.ts'
import { storeFailures } from './resolve.ts'

export type HealthBody = {
  version: string; siteSlug: string; lastSyncAt: string | null; snapshotVersion: number
  counts: { pages: number; redirects: number; articles: number; storeFailures: number }
  redirectHits: { source: string; hits: number }[]
}

/**
 * Read-only. It does NOT drain the hit counters — `sendHealth` does that, and only after the hub
 * has answered 2xx, so a ping that never arrives loses nothing. `GET /api/seo/health` therefore
 * has no side effect at all, which is what lets it be a plain authenticated read.
 */
export async function healthPayload(store: SeoStore, version: string, slug: string): Promise<HealthBody> {
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
    redirectHits: hits,
  }
}

/**
 * Hourly-or-whatever-cadence-startSync-uses ping. The counters are drained only after the hub
 * answers 2xx: draining first would throw the deltas away every time the hub is unreachable,
 * which is exactly when they matter.
 */
export async function sendHealth(store: SeoStore, version: string, cfg = readConfig()): Promise<boolean> {
  if (!cfg.hubUrl || !cfg.secret) return false
  try {
    const body = await healthPayload(store, version, cfg.slug)
    if (!body.siteSlug) return false   // nothing to address the hub with yet
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
