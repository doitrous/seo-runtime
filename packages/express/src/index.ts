import type { Request, RequestHandler, Response, Router } from 'express'
import {
  absoluteUrl, applySnapshot, bearerOf, DEFAULT_ARTICLE_PATH, EMPTY_SETTINGS, healthPayload,
  ingestArticles, normalizePath, readConfig, redirectFor, resolveSeo, robotsTxt, sitemapEntries,
  sitemapXml, startSync, timingSafeSecret,
  type ArticlePath, type IngestOptions, type ResolvedSeo, type SeoStore,
} from '@omary98/seo-runtime-core'
import { injectHead } from './inject.ts'

export { headTags, injectHead } from './inject.ts'

export type ProviderPage = { key: string; type: string; lang: string; path: string; title: string; updatedAt: string }
export type ExpressSeoOptions = {
  store: SeoStore
  pages: () => Promise<ProviderPage[]>
  supported?: string[]
  onArticle?: IngestOptions['onArticle']
  /** Where this site serves an article. Defaults to /{lang}/blog/{slug}. */
  articlePath?: ArticlePath
  version?: string
}

export const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * `POST /api/seo/sync` and `POST /api/articles` read their OWN bodies rather than depending on
 * the host app having `express.json()` mounted: relying on that is how `req.body` ends up
 * `undefined` when it isn't, and `express.json`'s own `limit` option is the only thing that would
 * enforce the 2 MB ceiling — which this package cannot assume a host actually set. Reading the
 * raw stream ourselves, with our own counting cap, works whether or not the host runs a body
 * parser of its own.
 *
 * If some earlier host middleware already consumed the stream (a global `express.json()` mounted
 * ahead of this registrar, for example), `req.readable` is `false` and there is nothing left on
 * the wire to count — in that case whatever that parser already put on `req.body` is used as-is,
 * without a 2 MB check of our own. Mount `seoRuntime(...)(app)` before any such body-parsing
 * middleware to get this package's own enforcement.
 *
 * A body that fails to parse as JSON resolves to `body: null` rather than answering 400 directly:
 * the caller (`applySnapshot`, `ingestArticles`) already turns a `null`/malformed body into the
 * right 400 shape for that route, so there is exactly one place that decides what an invalid body
 * looks like.
 *
 * Once the byte count passes `max` the verdict (`null`, meaning 413) is settled immediately —
 * the caller doesn't wait for the rest of the upload to answer. The stream itself is left
 * flowing rather than destroyed: closing a socket that still has unread bytes from the client
 * sitting in it earns a TCP reset instead of a clean close, which can swallow the 413 response
 * the caller is about to send. Draining (and discarding) the remainder in the background costs
 * nothing but the bytes already in flight, and lets the connection close cleanly once they land.
 */
async function readBody(req: Request, max: number): Promise<{ body: unknown } | null> {
  if (req.readable === false) return { body: (req as unknown as { body?: unknown }).body ?? null }

  const declared = Number(req.headers['content-length'] ?? 0)
  let over = Number.isFinite(declared) && declared > max

  const raw = await new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const done = (v: Buffer | null) => { if (!settled) { settled = true; resolve(v) } }
    if (over) done(null)
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > max) over = true
      if (!over) chunks.push(chunk)
      else done(null)
    })
    req.on('end', () => done(over ? null : Buffer.concat(chunks)))
    req.on('error', (err: Error) => { if (!settled) { settled = true; reject(err) } })
  })
  if (raw === null) return null
  if (raw.length === 0) return { body: null }
  try { return { body: JSON.parse(raw.toString('utf8')) } } catch { return { body: null } }
}

/**
 * The runtime's own article pages, next to the site's `pages()` provider. A site whose articles
 * live elsewhere (an `onArticle` hook) has an empty article store here, so this returns nothing
 * and the site's own provider lists them instead — each article appears exactly once.
 */
async function articlePages(store: SeoStore, articlePath: ArticlePath): Promise<ProviderPage[]> {
  const articles = await store.listArticles()
  return articles.map((a) => ({
    key: `article:${a.externalId}`, type: 'article', lang: a.lang,
    path: articlePath(a.lang, a.slug), title: a.title, updatedAt: a.updatedAt,
  }))
}

/**
 * Returns a registrar, not a handler: `app.use` only accepts a single handler, and this runtime
 * needs to register several routes plus middleware. Mount it with `seoRuntime({...})(app)`.
 *
 * Mount before the SPA static handler / catch-all. The redirect middleware is registered first so
 * it runs ahead of anything else this call adds — putting it ahead of the *host's own*
 * auth/session middleware is the host's responsibility: register `seoRuntime(...)(app)` before
 * mounting those.
 */
export function seoRuntime(opts: ExpressSeoOptions) {
  const version = opts.version ?? '0.1.1'
  const articlePath = opts.articlePath ?? DEFAULT_ARTICLE_PATH

  const auth: RequestHandler = (req, res, next) => {
    if (!timingSafeSecret(bearerOf(req.headers.authorization), readConfig().secret)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  }

  return function register(app: Router): void {
    // 1. Redirects, ahead of everything else registered here.
    app.use(async (req, res, next) => {
      const snapshot = await opts.store.getSnapshot().catch(() => null)
      // No `?? DEFAULT_RESERVED` fallback here: redirectFor itself unions the default reserved
      // prefixes into whatever is passed, so an explicit `reservedPrefixes: []` from the hub
      // can never unreserve /api or /admin. Passing `undefined` on a cold store still falls
      // through to redirectFor's own default parameter.
      const hit = await redirectFor(opts.store, req.originalUrl, snapshot?.settings.reservedPrefixes)
      if (hit) { res.redirect(hit.status, hit.destination); return }
      next()
    })

    const tooLarge = (res: Response) => res.status(413).json({ error: 'too large' })

    // 2. The runtime routes. Every one is Bearer-authenticated except /sitemap.xml and
    // /robots.txt (CONTRACT.md).
    app.post('/api/seo/sync', auth, async (req, res) => {
      const read = await readBody(req, MAX_BODY_BYTES)
      if (!read) { tooLarge(res); return }
      const result = await applySnapshot(opts.store, read.body)
      res.status(result.status === 'invalid' ? 400 : 200).json(result)
    })

    app.get('/api/seo/pages', auth, async (_req, res) => {
      const articles = await articlePages(opts.store, articlePath)
      res.json({ pages: [...await opts.pages(), ...articles] })
    })

    // Health names the site and enumerates every redirect source path, so it is authenticated
    // like every other route. It is read-only: it never drains the hit counters itself — only
    // core's `sendHealth` does that, and only after the hub answers 2xx (see `startSync` below).
    app.get('/api/seo/health', auth, async (_req, res) => {
      res.json(await healthPayload(opts.store, version, readConfig().slug))
    })

    app.get('/api/seo/probe', auth, async (req, res) => {
      res.json(await resolveSeo(opts.store, String(req.query.path ?? '/'), String(req.query.lang ?? 'en')))
    })

    app.post('/api/articles', auth, async (req, res) => {
      const read = await readBody(req, MAX_BODY_BYTES)
      if (!read) { tooLarge(res); return }
      const settings = (await opts.store.getSettings()) ?? EMPTY_SETTINGS
      const out = await ingestArticles(opts.store, read.body, {
        supported: opts.supported ?? ['en'],
        // The language's own origin, not just the first configured one — absoluteUrl already
        // carries that fallback for a language with no origin of its own.
        urlFor: (lang, slug) => absoluteUrl(settings, lang, articlePath(lang, slug)),
        onArticle: opts.onArticle,
      })
      res.status(out.status).json(out.body)
    })

    // Phase 1 ships a single /sitemap.xml only — no sitemap index / /sitemap-:page.xml route
    // (CONTRACT.md, deferred to phase 2). `sitemapXml` throws rather than truncating a sitemap
    // over the 5,000-URL limit; that is answered 500 with a clear message, not a silent 200.
    app.get('/sitemap.xml', async (_req, res) => {
      try {
        const snapshot = await opts.store.getSnapshot()
        res.type('application/xml')
        if (!snapshot) { res.send(sitemapXml([])); return }
        const entries = sitemapEntries(snapshot, await opts.store.listArticles(), articlePath)
        res.send(sitemapXml(entries))
      } catch (e) {
        res.status(500).type('text/plain').send(`sitemap error: ${(e as Error).message}`)
      }
    })

    // Anything else under /api/seo is authenticated before it is a 404, like the Next package:
    // the prefix never confirms which routes exist to an anonymous caller. (`app.use` with a
    // mount path is prefix matching on both Express 4 and 5; no wildcard syntax needed.)
    app.use('/api/seo', auth, (_req, res) => { res.status(404).json({ error: 'not found' }) })

    app.get('/robots.txt', async (_req, res) => {
      res.type('text/plain').send(robotsTxt(await opts.store.getSnapshot()))
    })

    // 3. res.locals.seo for the site's own views, and injectHead for an SPA shell. Resolution is
    // LAZY — a `() => Promise<ResolvedSeo>` function, not a resolved value — because running
    // resolveSeo eagerly here would resolve SEO for every image, stylesheet and XHR the site
    // serves, not just the page views that actually read it.
    app.use((req, res, next) => {
      let cached: Promise<ResolvedSeo> | null = null
      res.locals.seo = () => (cached ??= resolveSeo(opts.store, normalizePath(req.path), String(req.query.lang ?? 'en')))
      res.locals.injectHead = async (html: string) => injectHead(html, await res.locals.seo())
      next()
    })

    startSync(opts.store, { version })
  }
}
