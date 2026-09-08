import { createSeo } from '@omary98/seo-runtime-next'
import { store } from './store'

export const seo = createSeo({
  store,
  supported: ['en', 'ar'],
  version: '0.1.0',
  pages: async () => [
    { key: 'home', type: 'page', lang: 'en', path: '/en', title: 'Home', updatedAt: '2026-09-01T00:00:00.000Z' },
    { key: 'home', type: 'page', lang: 'ar', path: '/ar', title: 'الرئيسية', updatedAt: '2026-09-01T00:00:00.000Z' },
  ],
})
