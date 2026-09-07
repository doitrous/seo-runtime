import type { ResolvedSeo, Settings, SnapshotPage } from './types.ts'
import { DEFAULT_PAGE_DEFAULTS, EMPTY_SETTINGS, normalizePath } from './types.ts'
import type { SeoStore } from './store.ts'

export function absoluteUrl(settings: Settings, lang: string, path: string): string {
  const origin = (settings.baseUrls[lang] ?? Object.values(settings.baseUrls)[0] ?? '').replace(/\/+$/, '')
  return origin ? `${origin}${path.startsWith('/') ? '' : '/'}${path}` : path
}

export function organizationJsonLd(settings: Settings): Record<string, unknown> | null {
  const o = settings.organization
  if (!o?.name) return null
  const url = Object.values(settings.baseUrls)[0] ?? ''
  return {
    '@context': 'https://schema.org', '@type': o.type || 'Organization', name: o.name,
    ...(url ? { url } : {}), ...(o.logo ? { logo: o.logo } : {}),
    ...(o.sameAs?.length ? { sameAs: o.sameAs } : {}),
    ...(o.phone ? { telephone: o.phone } : {}), ...(o.email ? { email: o.email } : {}),
    ...(o.address ? { address: o.address } : {}), ...(o.hours ? { openingHours: o.hours } : {}),
  }
}

/**
 * The one definition. `sync.ts` (B7) imports it from here rather than keeping a second copy.
 */
export const isSchemaOrg = (e: Record<string, unknown>) =>
  e?.['@context'] === 'https://schema.org' && typeof e?.['@type'] === 'string'

let failures = 0
/** How many times a store read has thrown since boot. Reported by the health ping (B7). */
export const storeFailures = () => failures

/**
 * Pure resolution. Order: the page record, then the page type defaults, then site settings.
 * Never throws; with a null page it answers with the settings defaults.
 */
export function composeSeo(
  page: SnapshotPage | null, settings: Settings, path: string, lang: string, group: SnapshotPage[] = [],
): ResolvedSeo {
  const s = settings ?? EMPTY_SETTINGS
  const typeDefaults = (page && s.pageDefaults[page.type]) || DEFAULT_PAGE_DEFAULTS
  const seo = page?.seo

  const templated = page ? typeDefaults.titleTemplate.replace('%s', page.title) : s.organization.name
  const rawTitle = seo?.seoTitle?.trim() || templated || ''
  const suffix = s.brandSuffix ?? ''
  const title = rawTitle && suffix && !rawTitle.endsWith(suffix) ? `${rawTitle}${suffix}` : rawTitle

  const description = seo?.metaDescription ?? ''
  const canonical = seo?.canonical?.trim() || absoluteUrl(s, lang, path)

  // `resolveSeo` always passes at least the page itself, but `composeSeo` is exported and the
  // Laravel/WordPress ports call it with a bare page, so the fallback stays.
  const alternates: Record<string, string> = {}
  for (const g of group) alternates[g.lang] = absoluteUrl(s, g.lang, g.path)
  if (!group.length && page) alternates[page.lang] = canonical
  const defaultLang = alternates.en ? 'en' : Object.keys(alternates)[0]
  if (defaultLang) alternates['x-default'] = alternates[defaultLang]

  const og = {
    title: seo?.og.title || title,
    description: seo?.og.description || description,
    image: seo?.og.image || s.defaultOgImage || '',
  }
  const twitter = {
    title: seo?.twitter.title || og.title,
    description: seo?.twitter.description || og.description,
    image: seo?.twitter.image || og.image,
  }

  const override = (seo?.structuredData ?? []).filter(isSchemaOrg)
  const generated = page && !override.length
    ? [{
        '@context': 'https://schema.org',
        '@type': seo?.schemaType || typeDefaults.schemaType,
        '@id': `${canonical}#page`, url: canonical, name: rawTitle || page.title,
        ...(description ? { description } : {}), inLanguage: lang, dateModified: page.updatedAt,
      }]
    : override
  const org = organizationJsonLd(s)
  const jsonld = [...generated, ...(org ? [org] : [])] as Record<string, unknown>[]

  return {
    title, description, canonical,
    robots: { index: (seo?.index ?? true) && s.indexingEnabled, follow: seo?.follow ?? true },
    alternates, og, twitter, jsonld,
  }
}

/**
 * The renderer entry point. Two per-key store reads, never a whole-store read: with a SQL store
 * this is two indexed SELECTs per render instead of `SELECT *` over every page and redirect.
 * Never throws — but a swallowed failure is counted so the health ping can report it.
 */
export async function resolveSeo(store: SeoStore, rawPath: string, lang: string): Promise<ResolvedSeo> {
  const path = normalizePath(rawPath)
  try {
    const settings = (await store.getSettings()) ?? EMPTY_SETTINGS
    const page = await store.getPage(path, lang)
    if (!page) return composeSeo(null, settings, path, lang)
    const group = page.group ? await store.listGroup(page.group) : []
    return composeSeo(page, settings, path, lang, group.length ? group : [page])
  } catch {
    failures++
    return composeSeo(null, EMPTY_SETTINGS, path, lang)
  }
}
