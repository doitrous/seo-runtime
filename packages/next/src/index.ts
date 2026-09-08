import type { Metadata, MetadataRoute } from 'next'
import {
  DEFAULT_ARTICLE_PATH, jsonLdScript, resolveSeo, robotsTxt, sitemapEntries, sitemapXml,
  startSync, type ResolvedSeo,
} from '@omary98/seo-runtime-core'
import { handleSeoGet, handleSeoPost, MAX_BODY_BYTES, type SeoConfig } from './handlers.ts'

export type { SeoConfig, ProviderPage } from './handlers.ts'
export { MAX_BODY_BYTES }
export { SeoJsonLd } from './jsonld.ts'
export { withSeoRedirects } from './redirects.ts'

// Derived, never hand-written — a hand-written copy goes stale the moment createSeo grows a
// member.
export type SeoRuntime = ReturnType<typeof createSeo>

export function createSeo(config: SeoConfig) {
  const version = config.version ?? '0.1.2'

  const resolve = (path: string, lang: string): Promise<ResolvedSeo> => resolveSeo(config.store, path, lang)

  const metadata = async ({ path, lang }: { path: string; lang: string }): Promise<Metadata> => {
    const seo = await resolve(path, lang)
    return {
      title: seo.title, description: seo.description,
      alternates: { canonical: seo.canonical, languages: seo.alternates },
      robots: { index: seo.robots.index, follow: seo.robots.follow, googleBot: { index: seo.robots.index, follow: seo.robots.follow } },
      openGraph: { title: seo.og.title, description: seo.og.description, url: seo.canonical, images: seo.og.image ? [seo.og.image] : [] },
      twitter: { card: seo.twitter.image ? 'summary_large_image' : 'summary', title: seo.twitter.title, description: seo.twitter.description, images: seo.twitter.image ? [seo.twitter.image] : [] },
    }
  }

  const allEntries = async () => {
    const snapshot = await config.store.getSnapshot()
    if (!snapshot) return { snapshot: null, entries: [] as ReturnType<typeof sitemapEntries> }
    return { snapshot, entries: sitemapEntries(snapshot, await config.store.listArticles(), config.articlePath ?? DEFAULT_ARTICLE_PATH) }
  }

  /**
   * `app/sitemap.ts` — Next's own single-file sitemap convention. Phase 1 ships one `/sitemap.xml`
   * only: the sitemap index that would split a bigger site across `/sitemap-N.xml` is a phase 2
   * item (see CONTRACT.md and the B8 controller rulings), so there is no paging parameter here.
   * `sitemapXml` is the one place the 5,000-URL limit is enforced, by throwing rather than
   * truncating; calling it here — even though only the thrown error matters, Next serializes the
   * mapped array below on its own — means this can never drift from that limit.
   */
  const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
    const { entries } = await allEntries()
    sitemapXml(entries)
    return entries.map((e) => ({
      url: e.loc, lastModified: e.lastmod ? new Date(e.lastmod) : undefined,
      changeFrequency: e.changefreq as MetadataRoute.Sitemap[number]['changeFrequency'],
      priority: e.priority,
      alternates: Object.keys(e.alternates).length > 1 ? { languages: e.alternates } : undefined,
    }))
  }

  const robots = async () => new Response(robotsTxt(await config.store.getSnapshot()), { headers: { 'content-type': 'text/plain; charset=utf-8' } })

  /** `app/sitemap.xml/route.ts` — the single `/sitemap.xml` file, rendered by core's `sitemapXml`. */
  const sitemapResponse = async () => {
    const { entries } = await allEntries()
    return new Response(sitemapXml(entries), { headers: { 'content-type': 'application/xml; charset=UTF-8' } })
  }

  return {
    config, version, resolve, metadata, sitemap, robots, sitemapResponse,
    jsonLdScript,
    handlers: {
      GET: async (req: Request, ctx: { params: Promise<{ seo: string[] }> }) => handleSeoGet(config, req, (await ctx.params).seo.at(-1) ?? ''),
      POST: async (req: Request, ctx: { params: Promise<{ seo: string[] }> }) => handleSeoPost(config, req, (await ctx.params).seo.at(-1) ?? ''),
    },
    articleHandler: {
      // `POST /api/articles` is the same route as the catch-all's `articles` branch, mounted at
      // the site's own path. Reusing `handleSeoPost` is what keeps the auth and the 413 identical
      // in both places instead of a second copy that drifts.
      POST: async (req: Request) => handleSeoPost(config, req, 'articles'),
    },
    start: () => startSync(config.store, { version }),
  }
}

export async function seoMetadata(runtime: SeoRuntime, input: { path: string; lang: string }) {
  return runtime.metadata(input)
}
