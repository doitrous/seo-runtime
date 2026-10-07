# @omary98/seo-runtime-next

seo-hub runtime for the Next.js App Router: metadata, sitemap, robots, redirects, article ingest.

## Install

    npm install @omary98/seo-runtime-next @omary98/seo-runtime-core

## `createSeo`

    // lib/seo.ts
    import { createSeo } from '@omary98/seo-runtime-next'
    import { store } from './store'

    export const seo = createSeo({
      store, supported: ['en', 'ar'],
      pages: async () => [{ key: 'home', type: 'page', lang: 'en', path: '/en', title: 'Home', updatedAt: '...' }],
    })

Wire `seo.handlers` at `app/api/seo/[...seo]/route.ts`, `seo.articleHandler` at
`app/api/articles/route.ts`, `seo.sitemapResponse`/`seo.robots` at `app/sitemap.xml/route.ts` and
`app/robots.txt/route.ts`, and `seo.metadata`/`seo.resolve` from a page's `generateMetadata`.

## Start the sync (required)

`createSeo` alone never talks to the hub. Without `seo.start()` the site never pulls a snapshot
(the first page of SEO data, redirects and sitemap entries all come from it) and never pings
health, so the hub shows the site as unsynced. Call it once per server process from
`instrumentation.ts` in the Node runtime only (the proxy/edge runtime must not run it):

    // instrumentation.ts (project root, next to app/)
    export async function register() {
      if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { seo } = await import('./lib/seo')
        seo.start()
      }
    }

`seo.start()` pulls and pings once immediately, then pulls every 6 h and pings health hourly (the
timers are unref'd). It reads `SEO_HUB_URL`, `SEO_HUB_SECRET` and, until the first snapshot has
synced, `SEO_SITE_SLUG`. `examples/next-demo/lib/seo.ts` calls it at module scope instead, which
also works but only runs once some route imports `lib/seo`; `register()` runs at server boot.
The reported version defaults to the package's own version; don't pass `version` yourself.

## `proxy.ts`

Next 16's proxy convention (formerly `middleware.ts`) needs the `/edge` export only — the package
root pulls in the full core barrel (node:fs/node:sqlite/node:crypto stores), which fails the build:

    // proxy.ts
    import { withSeoRedirects } from '@omary98/seo-runtime-next/edge'
    import { store } from './lib/store'

    export default async function proxy(request) {
      return withSeoRedirects(store)({ url: request.url })
    }
    export const config = { matcher: ['/((?!_next).*)'] }

Set `skipTrailingSlashRedirect: true` in `next.config.ts` — without it, Next's own trailing-slash
308 fires before `proxy.ts` ever sees the request. See `packages/CONTRACT.md`'s Redirects section.

## Per-country pages (0.2.0)

When the hub sends several versions of one language (`ar-SA`, `ar-AE`, …), the first (the lead)
stays at `articlePath(lang, slug)` and the rest are served at `/ar-ae/blog/<slug>` (override with
`createSeo({ articleLocalePath: (locale, slug) => ... })`). Your `app/[lang]/blog/[slug]` route
already receives `ar-ae` as `params.lang`; look the article up with the runtime instead of by
language:

    // app/[lang]/blog/[slug]/page.tsx
    import { notFound } from 'next/navigation'
    import { seo } from '@/lib/seo'

    export async function generateMetadata({ params }) {
      const { lang, slug } = await params
      return (await seo.articleMetadata(lang, slug)) ?? {}   // canonical + every hreflang
    }

    export default async function Article({ params }) {
      const { lang, slug } = await params
      const article = await seo.article(lang, slug)          // 'ar' → lead, 'ar-ae' → ar-AE
      if (!article) notFound()
      return <article dir={article.lang === 'ar' ? 'rtl' : 'ltr'} dangerouslySetInnerHTML={{ __html: article.bodyHtml }} />
    }

If the layout validates `params.lang` against the site's languages, accept a locale too:
`parseLocalePrefix('/' + params.lang, supported)` (also exported from
`@omary98/seo-runtime-next/edge` for `proxy.ts`) returns `{lang, locale}` or null.
`seo.articleHref(article)` gives a version's own path.
