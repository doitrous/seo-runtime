import {
  applySnapshot, bearerOf, DEFAULT_ARTICLE_PATH, healthPayload, ingestArticles, readConfig,
  resolveSeo, timingSafeSecret,
  type ArticlePath, type IngestOptions, type ResolvedSeo, type SeoStore,
} from '@doitrous/seo-runtime-core'

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
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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
  const version = config.version ?? '0.1.0'
  // Health is authenticated like everything else: it names the site and enumerates every
  // redirect source path. It has no side effect — the counters are drained by `sendHealth`,
  // after the hub answers 2xx.
  if (!authorized(req)) return unauthorized()
  if (route === 'health') return json(await healthPayload(config.store, version, readConfig().slug))
  if (route === 'pages') {
    return json({ pages: [...await config.pages(), ...await articlePages(config.store, config.articlePath ?? DEFAULT_ARTICLE_PATH)] })
  }
  if (route === 'probe') {
    const url = new URL(req.url)
    const seo: ResolvedSeo = await resolveSeo(config.store, url.searchParams.get('path') ?? '/', url.searchParams.get('lang') ?? 'en')
    return json(seo)
  }
  return json({ error: 'not found' }, 404)
}

export async function handleSeoPost(config: SeoConfig, req: Request, route: string): Promise<Response> {
  if (!authorized(req)) return unauthorized()
  const read = await readJsonBody(req)
  if (!read) return json({ error: 'too large' }, 413)
  if (route === 'sync') {
    const result = await applySnapshot(config.store, read.body)
    return json(result, result.status === 'invalid' ? 400 : 200)   // CONTRACT: malformed snapshot is 400, never 500
  }
  if (route === 'articles') return handleArticles(config, read.body)
  return json({ error: 'not found' }, 404)
}

export async function handleArticles(config: SeoConfig, body: unknown): Promise<Response> {
  const settings = await config.store.getSettings()
  const origin = (Object.values(settings?.baseUrls ?? {})[0] ?? '').replace(/\/+$/, '')
  const path = config.articlePath ?? DEFAULT_ARTICLE_PATH
  const out = await ingestArticles(config.store, body, {
    supported: config.supported ?? ['en'],
    urlFor: (lang, slug) => `${origin}${path(lang, slug)}`,
    onArticle: config.onArticle,
  })
  return json(out.body, out.status)
}
