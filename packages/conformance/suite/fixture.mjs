export const BASE = process.env.CONFORMANCE_BASE
export const SECRET = process.env.CONFORMANCE_SECRET
export const SLUG = process.env.CONFORMANCE_SLUG

export const auth = { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }

// Every file in this suite drives the SAME demo store through ascending snapshot versions — a
// version equal to or lower than the one already stored is answered `stale`, never `applied`
// (packages/CONTRACT.md). The demo persists its state to disk (JsonFileStore), so a hardcoded
// version works once and then fails forever on every later run. Seeding the counter from
// `Date.now()` means a fresh run's first version is always higher than anything a previous run
// left behind — real time only moves forward — and incrementing it on every call keeps this run's
// own versions strictly ascending too.
let counter = Date.now()
export const nextVersion = () => ++counter

export const snapshot = (over = {}) => ({
  version: over.version ?? nextVersion(), siteSlug: SLUG,
  settings: {
    baseUrls: { en: BASE, ar: BASE }, indexingEnabled: true, brandSuffix: ' | Demo', defaultOgImage: `${BASE}/og.png`,
    organization: { name: 'Demo Co', logo: '', sameAs: [], phone: '', email: '', address: '', hours: '', type: 'Organization' },
    robotsExtra: ['Disallow: /tmp'],
    pageDefaults: { page: { titleTemplate: '%s', schemaType: 'WebPage', changefreq: 'weekly', priority: 0.7 } },
    reservedPrefixes: ['/api', '/admin'], twitterHandle: '@demo',
  },
  pages: [
    page('en', '/en/a'), page('ar', '/ar/a'),
  ],
  redirects: [
    { source: '/old', destination: '/en/a', type: 301, active: true },
    { source: '/off', destination: '/en/a', type: 302, active: false },
    { source: '/old-302', destination: '/en/a', type: 302, active: true },
    { source: '/old-307', destination: '/en/a', type: 307, active: true },
    { source: '/old-308', destination: '/en/a', type: 308, active: true },
    { source: '/api/old', destination: '/en/a', type: 301, active: true },
    { source: '/bad', destination: 'http://evil.example', type: 301, active: true },
  ],
  ...over,
})

function page(lang, path) {
  return {
    key: 'p:1', type: 'page', lang, path, group: 'p:1', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z',
    seo: {
      seoTitle: 'A page', metaDescription: 'About A.', canonical: '', index: true, follow: true,
      includeInSitemap: true, priority: 0.8,
      og: { title: '', description: '', image: '' }, twitter: { title: '', description: '', image: '' },
      schemaType: '', structuredData: [], faq: [],
    },
  }
}

export const sync = (body) => fetch(`${BASE}/api/seo/sync`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
export const probe = (path, lang) => fetch(`${BASE}/api/seo/probe?path=${encodeURIComponent(path)}&lang=${lang}`, { headers: auth })
export const health = () => fetch(`${BASE}/api/seo/health`, { headers: auth })
export const healthAnon = () => fetch(`${BASE}/api/seo/health`)
export const articles = (body) => fetch(`${BASE}/api/articles`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
