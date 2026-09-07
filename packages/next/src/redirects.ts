// `/edge`, not the package root: a proxy is bundled for the edge runtime, and the full barrel
// re-exports the file and SQL stores (node:fs, node:sqlite, node:url) plus config.ts (node:crypto).
// Importing those from a proxy is a build failure, so this module may never reach for them.
import { redirectFor, type SeoStore, type Settings } from '@doitrous/seo-runtime-core/edge'

type Req = { url: string }
type Continue = Response | undefined

/**
 * Wrap the site's own middleware/proxy — or use it alone. Redirects are checked first, before any
 * session work, and a store failure falls straight through.
 *
 * With no `next`, a request that is not redirected returns `undefined`, which is Next's "carry on
 * and render the route". Returning `new Response(null, {status: 200})` here would blank every page
 * on the site, which is exactly how the demo and yayatours mount it.
 *
 * `store` rather than the runtime: the runtime instance owns the site's provider callbacks and,
 * on Aspects, a service-role database client created at module load. A proxy needs none of that.
 */
export function withSeoRedirects(
  store: SeoStore, next?: (req: Req) => Promise<Continue> | Continue,
) {
  return async (req: Req): Promise<Continue> => {
    const settings: Settings | null = await store.getSettings().catch(() => null)
    // No `?? DEFAULT_RESERVED` fallback: redirectFor itself unions the default reserved prefixes
    // into whatever is passed, so `reservedPrefixes: []` from the hub can never unreserve /api or
    // /admin, and `undefined` on a cold store still falls through to redirectFor's own default.
    const hit = await redirectFor(store, req.url, settings?.reservedPrefixes)
    if (hit) {
      const location = hit.destination.startsWith('/') ? new URL(hit.destination, req.url).toString() : hit.destination
      return new Response(null, { status: hit.status, headers: { location } })
    }
    return next ? next(req) : undefined
  }
}
