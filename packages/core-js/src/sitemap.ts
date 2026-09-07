import type { ArticlePath, Snapshot, StoredArticle } from './types.ts'
import { DEFAULT_ARTICLE_PATH, DEFAULT_PAGE_DEFAULTS } from './types.ts'
import { absoluteUrl } from './resolve.ts'

// The per-file URL limit from the contract. The sitemap index that would split a bigger site
// across /sitemap-1.xml, /sitemap-2.xml, ... is deferred to phase 2 (controller ruling for this
// task) — `sitemapXml` enforces the limit by throwing rather than silently truncating a page.
export const SITEMAP_PAGE_SIZE = 5000

export type SitemapEntry = {
  loc: string; lastmod?: string; changefreq: string; priority: number
  alternates: Record<string, string>
}

/**
 * The package's one escaper. `&apos;` is valid in XML and in HTML5, so `markdown.ts` (B6)
 * re-exports this as `escapeHtml` rather than keeping a second near-identical copy that
 * differs only in emitting `&#39;`.
 */
export function xmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

/** Omits `lastmod` for an unparsable date rather than throwing `RangeError` out of the route. */
const day = (iso: string) => {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

function withDefault(alternates: Record<string, string>): Record<string, string> {
  const lang = alternates.en ? 'en' : Object.keys(alternates)[0]
  return lang ? { ...alternates, 'x-default': alternates[lang] } : alternates
}

/**
 * `articlePath` is a per-site option, never a constant: Aspects serves /{lang}/articles/{slug},
 * Nishany /blog/{lang}/{slug}, YayaTours and TourMedX the default. The default lives in
 * `types.ts` as `DEFAULT_ARTICLE_PATH`; this module only ever receives one.
 */
export function sitemapEntries(
  snapshot: Snapshot, articles: StoredArticle[], articlePath: ArticlePath = DEFAULT_ARTICLE_PATH,
): SitemapEntry[] {
  if (!snapshot.settings.indexingEnabled) return []
  const s = snapshot.settings
  const out: SitemapEntry[] = []

  const byGroup = new Map<string, typeof snapshot.pages>()
  for (const p of snapshot.pages) {
    const g = byGroup.get(p.group) ?? []
    g.push(p)
    byGroup.set(p.group, g)
  }
  for (const p of snapshot.pages) {
    if (!p.seo.index || !p.seo.includeInSitemap) continue
    const group = p.group ? (byGroup.get(p.group) ?? [p]) : [p]
    const alternates: Record<string, string> = {}
    for (const g of group) alternates[g.lang] = absoluteUrl(s, g.lang, g.path)
    const typeDefaults = s.pageDefaults[p.type] ?? DEFAULT_PAGE_DEFAULTS
    out.push({
      loc: absoluteUrl(s, p.lang, p.path), lastmod: day(p.updatedAt),
      changefreq: typeDefaults.changefreq,
      priority: p.seo.priority ?? typeDefaults.priority ?? 0.5,
      alternates: withDefault(alternates),
    })
  }

  // Grouped by external id, not slug: two different jobs may use the same slug in different
  // languages and must not become each other's alternates.
  const byJob = new Map<number, StoredArticle[]>()
  for (const a of articles) {
    const g = byJob.get(a.externalId) ?? []
    g.push(a)
    byJob.set(a.externalId, g)
  }
  for (const group of byJob.values()) {
    const alternates: Record<string, string> = {}
    for (const a of group) alternates[a.lang] = absoluteUrl(s, a.lang, articlePath(a.lang, a.slug))
    for (const a of group) {
      out.push({
        loc: absoluteUrl(s, a.lang, articlePath(a.lang, a.slug)), lastmod: day(a.updatedAt),
        changefreq: (s.pageDefaults.article ?? DEFAULT_PAGE_DEFAULTS).changefreq,
        // Same fallback chain as a page: the type default, then DEFAULT_PAGE_DEFAULTS.priority.
        // No per-type magic number.
        priority: (s.pageDefaults.article ?? DEFAULT_PAGE_DEFAULTS).priority,
        alternates: withDefault(alternates),
      })
    }
  }
  return out
}

export function sitemapXml(entries: SitemapEntry[]): string {
  if (entries.length > SITEMAP_PAGE_SIZE) {
    throw new Error(
      `sitemap has ${entries.length} URLs, over the ${SITEMAP_PAGE_SIZE}-URL per-file limit; ` +
      'the sitemap index that would split this across multiple files is deferred to phase 2',
    )
  }
  const urls = entries.map((e) => {
    const alts = Object.entries(e.alternates)
      .map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${xmlEscape(lang)}" href="${xmlEscape(href)}"/>`).join('')
    return `<url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}` +
      `<changefreq>${xmlEscape(e.changefreq)}</changefreq><priority>${e.priority.toFixed(1)}</priority>${alts}</url>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`
}
