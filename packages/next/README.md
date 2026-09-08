# @omary98/seo-runtime-next

seo-hub runtime for the Next.js App Router: metadata, sitemap, robots, redirects, article ingest.

## Install

    npm install @omary98/seo-runtime-next @omary98/seo-runtime-core

## `createSeo`

    // lib/seo.ts
    import { createSeo } from '@omary98/seo-runtime-next'
    import { store } from './store'

    export const seo = createSeo({
      store, supported: ['en', 'ar'], version: '0.1.1',
      pages: async () => [{ key: 'home', type: 'page', lang: 'en', path: '/en', title: 'Home', updatedAt: '...' }],
    })

Wire `seo.handlers` at `app/api/seo/[...seo]/route.ts`, `seo.articleHandler` at
`app/api/articles/route.ts`, `seo.sitemapResponse`/`seo.robots` at `app/sitemap.xml/route.ts` and
`app/robots.txt/route.ts`, and `seo.metadata`/`seo.resolve` from a page's `generateMetadata`.

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
