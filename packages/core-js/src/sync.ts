import type { SeoStore } from './store.ts'
import type { Snapshot } from './types.ts'
import { readConfig } from './config.ts'
import { safeDestination } from './redirects.ts'
import { isSchemaOrg } from './resolve.ts'
import { sendHealth } from './health.ts'

/** Everything the runtime refuses to render is dropped once, here, rather than at every render. */
export function sanitizeSnapshot(s: Snapshot): Snapshot {
  return {
    ...s,
    redirects: s.redirects.filter((r) => safeDestination(r.destination) !== null),
    pages: s.pages.map((p) => ({ ...p, seo: { ...p.seo, structuredData: (p.seo.structuredData ?? []).filter(isSchemaOrg) } })),
  }
}

const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Validated deep enough that `sanitizeSnapshot` can dereference what it touches. A truthy-only
 * check would let an authenticated push with a malformed page turn into a 500 inside
 * `p.seo.structuredData`; the contract says a bad body is a 400.
 */
function isSnapshot(body: unknown): body is Snapshot {
  const b = body as Snapshot | null
  if (!b || !Number.isInteger(b.version) || typeof b.siteSlug !== 'string') return false
  if (!obj(b.settings) || !Array.isArray(b.pages) || !Array.isArray(b.redirects)) return false
  if (!b.pages.every((p) => obj(p) && typeof p.path === 'string' && typeof p.lang === 'string' && obj(p.seo))) return false
  return b.redirects.every((r) => obj(r) && typeof r.source === 'string' && typeof r.destination === 'string')
}

/**
 * Applies a pushed or pulled snapshot. A version below the stored one is ignored, and a snapshot
 * addressed to a different site is refused outright — a runtime must never render another site's
 * pages because a slug was mistyped in the hub.
 *
 * On a cold store (nothing synced yet) there is no stored `siteSlug` to check against, so the
 * configured `SEO_SITE_SLUG` stands in for it when one is set: the boot state is exactly when a
 * mistyped slug in the hub would otherwise seed the wrong site's pages with no prior snapshot to
 * catch it.
 */
export async function applySnapshot(
  store: SeoStore, incoming: unknown, cfg = readConfig(),
): Promise<{ status: 'applied' | 'stale' | 'invalid'; version: number }> {
  if (!isSnapshot(incoming)) return { status: 'invalid', version: 0 }
  const current = await store.getSnapshot()
  const expectedSlug = current?.siteSlug || cfg.slug
  if (expectedSlug && incoming.siteSlug !== expectedSlug) return { status: 'invalid', version: current?.version ?? 0 }
  if (current && incoming.version < current.version) return { status: 'stale', version: current.version }
  await store.putSnapshot(sanitizeSnapshot(incoming))
  return { status: 'applied', version: incoming.version }
}

export async function pullSnapshot(store: SeoStore, cfg = readConfig()): Promise<'applied' | 'stale' | 'failed'> {
  if (!cfg.hubUrl || !cfg.secret) return 'failed'
  const slug = cfg.slug || (await store.getSnapshot())?.siteSlug
  if (!slug) return 'failed'
  try {
    const res = await fetch(`${cfg.hubUrl}/api/sites/${encodeURIComponent(slug)}/snapshot`, {
      headers: { Authorization: `Bearer ${cfg.secret}` },
    })
    if (!res.ok) return 'failed'
    const out = await applySnapshot(store, await res.json())
    return out.status === 'invalid' ? 'failed' : out.status
  } catch {
    return 'failed'
  }
}

export const PULL_INTERVAL_MS = 6 * 60 * 60_000
/** The contract's health cadence — hourly, not the 6 h snapshot-pull cadence. */
export const HEALTH_INTERVAL_MS = 60 * 60_000

/**
 * Boot-time wiring: pulls the snapshot and pings health once immediately, then the two run on
 * their own cadence from then on — the pull every `intervalMs` (default 6 h) and health every
 * `healthIntervalMs` (default hourly, matching the Laravel and WordPress ports). Both timers are
 * unref'd so neither holds the process open. Returns a stop function that clears both.
 */
export function startSync(
  store: SeoStore, opts: { version: string; intervalMs?: number; healthIntervalMs?: number },
): () => void {
  void pullSnapshot(store)
  void sendHealth(store, opts.version)
  const pullTimer = setInterval(() => void pullSnapshot(store), opts.intervalMs ?? PULL_INTERVAL_MS)
  pullTimer.unref?.()
  const healthTimer = setInterval(() => void sendHealth(store, opts.version), opts.healthIntervalMs ?? HEALTH_INTERVAL_MS)
  healthTimer.unref?.()
  return () => { clearInterval(pullTimer); clearInterval(healthTimer) }
}
