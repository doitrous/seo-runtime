import { createSeo } from '@omary98/seo-runtime-next'
import { store } from './store'

export const seo = createSeo({
  store,
  supported: ['en', 'ar'],
  version: '0.1.2',
  pages: async () => [
    { key: 'home', type: 'page', lang: 'en', path: '/en', title: 'Home', updatedAt: '2026-09-01T00:00:00.000Z' },
    { key: 'home', type: 'page', lang: 'ar', path: '/ar', title: 'الرئيسية', updatedAt: '2026-09-01T00:00:00.000Z' },
  ],
})

// CONTRACT.md: the periodic pull (every 6 h) and hourly health ping. `lib/seo.ts` is imported by
// every server route that needs `seo`, so module-scope is the one place this always runs exactly
// once per server process without a dedicated boot hook. Never imported by proxy.ts, which reaches
// straight into `./store` instead — this timer never runs on the edge/middleware runtime.
seo.start()
