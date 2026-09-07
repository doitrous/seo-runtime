export type Meta = { title: string; description: string; image: string }

export type Organization = {
  name: string; logo: string; sameAs: string[]; phone: string; email: string
  address: string; hours: string; type: string
}

export type PageTypeDefaults = { titleTemplate: string; schemaType: string; changefreq: string; priority: number }

export type Settings = {
  baseUrls: Record<string, string>
  indexingEnabled: boolean
  brandSuffix: string
  defaultOgImage: string
  organization: Organization
  robotsExtra: string[]
  pageDefaults: Record<string, PageTypeDefaults>
  reservedPrefixes: string[]
  twitterHandle: string
}

export type PageSeo = {
  seoTitle: string; metaDescription: string; canonical: string
  index: boolean; follow: boolean; includeInSitemap: boolean; priority: number
  og: Meta; twitter: Meta; schemaType: string
  structuredData: Record<string, unknown>[]; faq: { q: string; a: string }[]
}

export type SnapshotPage = {
  key: string; type: string; lang: string; path: string; group: string
  title: string; updatedAt: string; seo: PageSeo
}

export type StoredRedirect = { source: string; destination: string; type: number; active: boolean }

export type StoredArticle = {
  externalId: number; lang: string; slug: string; title: string
  metaTitle: string; metaDescription: string; bodyMd: string; bodyHtml: string
  faq: { q: string; a: string }[]; schemaJsonld: Record<string, unknown>[]
  imageUrl: string | null; imageAlt: string | null
  authorName: string | null; authorCredentials: string | null
  references: { title: string; url: string }[]
  og: Meta
  /**
   * Every spec-1 payload field that has no column of its own: `reviewer`, `reviewedAt`,
   * `checklist`, `cta`, `plannedUpdateAt`, `secondaryKeywords`, `searchIntent`, `sections`.
   * Kept verbatim rather than dropped, because a site whose articles live in this store
   * (Nishany) would otherwise lose exactly the fields spec 1 added.
   */
  extra: Record<string, unknown>
  publishedAt: string; updatedAt: string
}

/**
 * The snapshot carries NO articles. Articles arrive only through `POST /api/articles`; nothing
 * in any runtime applies articles from a snapshot, and keeping them out is what holds the body
 * under the 2 MB limit for a site with thousands of published articles.
 */
export type Snapshot = {
  version: number; siteSlug: string; settings: Settings
  pages: SnapshotPage[]; redirects: StoredRedirect[]
}

/**
 * Query, hash and trailing slash never take part in a lookup. Lives here, in the module with no
 * imports, because `resolve.ts` and `redirects.ts` both need it and neither may own it.
 */
export function normalizePath(p: string): string {
  const bare = String(p ?? '').split('#')[0].split('?')[0].trim()
  const withSlash = bare.startsWith('/') ? bare : `/${bare}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : '/'
}

/** Where this site serves an article. Per-site, because no two of the four agree. */
export type ArticlePath = (lang: string, slug: string) => string

export const DEFAULT_ARTICLE_PATH: ArticlePath = (lang, slug) => `/${lang}/blog/${slug}`

export type ResolvedSeo = {
  title: string; description: string; canonical: string
  robots: { index: boolean; follow: boolean }
  alternates: Record<string, string>
  og: Meta; twitter: Meta
  jsonld: Record<string, unknown>[]
}

export const EMPTY_META: Meta = { title: '', description: '', image: '' }

export const EMPTY_SETTINGS: Settings = {
  baseUrls: {}, indexingEnabled: true, brandSuffix: '', defaultOgImage: '',
  organization: { name: '', logo: '', sameAs: [], phone: '', email: '', address: '', hours: '', type: 'Organization' },
  robotsExtra: [], pageDefaults: {}, reservedPrefixes: ['/api', '/admin'], twitterHandle: '',
}

export const DEFAULT_PAGE_DEFAULTS: PageTypeDefaults = { titleTemplate: '%s', schemaType: 'WebPage', changefreq: 'monthly', priority: 0.5 }
