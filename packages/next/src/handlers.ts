import {
  absoluteUrl, applySnapshot, bearerOf, DEFAULT_ARTICLE_PATH, EMPTY_SETTINGS, healthPayload,
  ingestArticles, proxyApprovalAction, proxyPending, readConfig, resolveSeo, submitIndexNow,
  submitVitals, timingSafeSecret,
  type ApprovalAction, type ArticlePath, type IngestOptions, type ResolvedSeo, type SeoStore,
  RUNTIME_VERSION,
} from '@omary98/seo-runtime-core'

export const MAX_BODY_BYTES = 2 * 1024 * 1024

export type ProviderPage = { key: string; type: string; lang: string; path: string; title: string; updatedAt: string }

export type SeoConfig = {
  store: SeoStore
  pages: () => Promise<ProviderPage[]>
  supported?: string[]
  onArticle?: IngestOptions['onArticle']
  /** Where this site serves an article. Defaults to /{lang}/blog/{slug}; three of four sites differ. */
  articlePath?: ArticlePath
  version?: string
  /** Reported on the health ping. Next never renders the share block itself (a site includes
   * `<ShareBlock/>` where it wants one, same as `<SeoJsonLd/>`) — this package has no way to
   * verify it's actually wired in, unlike Express/Laravel, which append the block themselves.
   * Defaults to `false`; pass `share: true` once `<ShareBlock/>` is in place to opt in. */
  share?: boolean
}

// The Fetch spec forbids a body on these three statuses — the WebIDL Response constructor
// throws rather than silently dropping it. Every hub-proxy route (pending/approve/reject/
// publish-now/indexnow/vitals) passes the hub's own status through verbatim, and a 204 is a
// perfectly ordinary "no content" answer for a hub to give an approve or a vitals beacon, so
// this has to hold for any status this function is ever called with, not just the 200s already
// exercised by an existing test.
const NULL_BODY_STATUSES = new Set([204, 205, 304])
const json = (body: unknown, status = 200) =>
  NULL_BODY_STATUSES.has(status)
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const unauthorized = () => json({ error: 'unauthorized' }, 401)

export function authorized(req: Request): boolean {
  return timingSafeSecret(bearerOf(req.headers.get('authorization')), readConfig().secret)
}

/**
 * Reads the body with a hard byte ceiling. `content-length` alone is not enough: a chunked
 * request carries none, so the limit has to be enforced while the stream is consumed. Returns
 * `null` when the request is too large, and the caller answers 413.
 */
export async function readJsonBody(req: Request): Promise<{ body: unknown } | null> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!req.body) return { body: null }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
  try { return { body: JSON.parse(text) } } catch { return { body: null } }
}

/**
 * The runtime's own article pages, so the hub registry sees them next to the site's pages.
 * A site whose articles live elsewhere (an `onArticle` hook) has an empty article store, so this
 * returns nothing and the site's own `pages` provider lists them instead — each article appears
 * exactly once across the two sources.
 */
export async function articlePages(store: SeoStore, articlePath: ArticlePath): Promise<ProviderPage[]> {
  const articles = await store.listArticles()
  return articles.map((a) => ({
    key: `article:${a.externalId}`, type: 'article', lang: a.lang,
    path: articlePath(a.lang, a.slug), title: a.title, updatedAt: a.updatedAt,
  }))
}

export async function handleSeoGet(config: SeoConfig, req: Request, route: string): Promise<Response> {
  const version = config.version ?? RUNTIME_VERSION
  // Health is authenticated like everything else: it names the site and enumerates every
  // redirect source path. It has no side effect — the counters are drained by `sendHealth`,
  // after the hub answers 2xx.
  if (!authorized(req)) return unauthorized()
  if (route === 'health') return json(await healthPayload(config.store, version, readConfig().slug, config.share === true))
  if (route === 'pages') {
    return json({ pages: [...await config.pages(), ...await articlePages(config.store, config.articlePath ?? DEFAULT_ARTICLE_PATH)] })
  }
  if (route === 'probe') {
    const url = new URL(req.url)
    const seo: ResolvedSeo = await resolveSeo(config.store, url.searchParams.get('path') ?? '/', url.searchParams.get('lang') ?? 'en')
    return json(seo)
  }
  // v2: pending/approve proxy. This site's own secret in (the `authorized` check above), the
  // hub's runtime secret out. The hub's status and body — publish_blocked included — pass
  // through verbatim.
  if (route === 'pending') {
    const out = await proxyPending(config.store)
    return json(out.body, out.status)
  }
  return json({ error: 'not found' }, 404)
}

const APPROVAL_ACTIONS: ApprovalAction[] = ['approve', 'reject', 'publish-now']

export async function handleSeoPost(config: SeoConfig, req: Request, route: string): Promise<Response> {
  // v2: the opt-in web-vitals beacon (webVitalsSnippet, in core) posts here with NO secret — it
  // runs in a real visitor's browser, which is not a place to keep this site's secret. Checked
  // before the `authorized` gate below, which every other route in this function needs. The
  // secret is attached only on the way OUT, to the hub (submitVitals, in core).
  if (route === 'vitals') {
    const read = await readJsonBody(req)
    if (!read) return json({ error: 'too large' }, 413)
    const body = (read.body ?? {}) as { url?: string; lcp?: number; inp?: number; cls?: number }
    const out = await submitVitals(config.store, { url: String(body.url ?? ''), lcp: body.lcp, inp: body.inp, cls: body.cls })
    return json(out.body, out.status)
  }
  if (!authorized(req)) return unauthorized()
  const read = await readJsonBody(req)
  if (!read) return json({ error: 'too large' }, 413)
  if (route === 'sync') {
    const result = await applySnapshot(config.store, read.body)
    return json(result, result.status === 'invalid' ? 400 : 200)   // CONTRACT: malformed snapshot is 400, never 500
  }
  if (route === 'articles') return handleArticles(config, read.body)
  if (APPROVAL_ACTIONS.includes(route as ApprovalAction)) {
    const body = (read.body ?? {}) as { jobId?: string; approvedBy?: string; note?: string }
    const out = await proxyApprovalAction(config.store, route as ApprovalAction, String(body.jobId ?? ''), { approvedBy: String(body.approvedBy ?? ''), note: body.note })
    return json(out.body, out.status)
  }
  // v2: IndexNow. This site's own secret in (the `authorized` check above), then forwards
  // { urlList } to api.indexnow.org with settings.indexNowKey (submitIndexNow, in core).
  if (route === 'indexnow') {
    const settings = (await config.store.getSettings()) ?? EMPTY_SETTINGS
    const body = (read.body ?? {}) as { urlList?: unknown }
    const out = await submitIndexNow(settings, body.urlList)
    return json(out.body, out.status)
  }
  return json({ error: 'not found' }, 404)
}

export async function handleArticles(config: SeoConfig, body: unknown): Promise<Response> {
  const settings = (await config.store.getSettings()) ?? EMPTY_SETTINGS
  const path = config.articlePath ?? DEFAULT_ARTICLE_PATH
  const out = await ingestArticles(config.store, body, {
    supported: config.supported ?? ['en'],
    // The language's own origin, not just the first configured one — absoluteUrl already
    // carries that fallback for a language with no origin of its own.
    urlFor: (lang, slug) => absoluteUrl(settings, lang, path(lang, slug)),
    onArticle: config.onArticle,
  })
  return json(out.body, out.status)
}
