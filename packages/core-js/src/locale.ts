import type { ArticlePath, StoredArticle } from './types.ts'

/**
 * Per-country pages (hub contract 1.20.0). Edge-safe: no node: imports, so `edge.ts` re-exports
 * this whole module for a Next proxy.
 *
 * Vocabulary: a *lang* is the plain language code a site already serves (`ar`); a *locale* is a
 * language plus a region (`ar-AE`). The **lead** version of a language is the first payload item
 * of that language; it keeps the language's existing URL (`articlePath(lang, slug)`). Every other
 * version of that language is served under a lowercase locale prefix (`/ar-ae/blog/x`).
 */

const LOCALE_RE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})+$/
const LANG_RE = /^[A-Za-z]{2,3}$/

/** True for a region-coded locale (`ar-AE`, `ar-ae`, `ar_AE`), false for a plain lang (`ar`). */
export function isLocaleCode(s: string): boolean {
  return LOCALE_RE.test(String(s ?? ''))
}

/** True for anything usable as a hreflang language: a plain lang or a locale. */
export function isLangOrLocale(s: string): boolean {
  return LANG_RE.test(String(s ?? '')) || isLocaleCode(s)
}

/**
 * `ar-ae` / `ar_AE` / `AR-ae` → `ar-AE`; `zh-hant-tw` → `zh-Hant-TW`; a plain lang is
 * lowercased. One spelling per locale, so storage keys and lookups compare exactly.
 */
export function canonicalLocale(s: string): string {
  const parts = String(s ?? '').trim().split(/[-_]/).filter(Boolean)
  if (!parts.length) return ''
  return parts.map((p, i) => {
    if (i === 0) return p.toLowerCase()
    if (p.length === 2 || /^\d{3}$/.test(p)) return p.toUpperCase()          // region
    if (p.length === 4) return p[0].toUpperCase() + p.slice(1).toLowerCase() // script
    return p.toLowerCase()
  }).join('-')
}

/** The language part of a locale: `ar-AE` → `ar`; a plain lang is returned lowercased. */
export function langOfLocale(locale: string): string {
  return canonicalLocale(locale).split('-')[0] ?? ''
}

/** A stored version's locale. Rows written before 0.2.0 have none: their locale is their lang. */
export function localeOf(a: Pick<StoredArticle, 'lang' | 'locale'>): string {
  return a.locale ? canonicalLocale(a.locale) : a.lang
}

/** Rows written before 0.2.0 have no `lead` flag: each was the only version of its language. */
export function isLead(a: Pick<StoredArticle, 'lead'>): boolean {
  return a.lead !== false
}

/** Fills the 0.2.0 fields on a row written by an older runtime (or a site's own store). */
export function withVersionDefaults(a: StoredArticle): StoredArticle {
  return { ...a, locale: localeOf(a), lead: isLead(a), hreflang: a.hreflang ?? {} }
}

/**
 * The default move from a language URL to a locale URL: the first path segment equal to the
 * language (`/ar/blog/x`, `/blog/ar/x`) is replaced with the lowercase locale
 * (`/ar-ae/blog/x`, `/blog/ar-ae/x`); a path with no language segment (a default language served
 * unprefixed, `/blog/x`) gets `/<locale>` prepended (`/en-us/blog/x`). The last segment (the slug)
 * is never treated as the language. Works on a path or on an absolute URL.
 */
export function localizePath(pathOrUrl: string, lang: string, locale: string): string {
  const loc = canonicalLocale(locale).toLowerCase()
  const l = String(lang ?? '').toLowerCase()
  let origin = '', rest = String(pathOrUrl ?? '')
  const m = rest.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i)
  if (m) { origin = m[1]; rest = m[2] }
  const cut = rest.search(/[?#]/)
  const suffix = cut >= 0 ? rest.slice(cut) : ''
  const path = (cut >= 0 ? rest.slice(0, cut) : rest) || '/'
  const segs = path.split('/')
  // segs[0] is '' (leading slash); the final non-empty segment is the slug.
  let last = segs.length - 1
  while (last > 0 && segs[last] === '') last--
  const i = segs.findIndex((s, idx) => idx > 0 && idx < last && s.toLowerCase() === l)
  let out: string
  if (i > 0) { segs[i] = loc; out = segs.join('/') }
  else out = `/${loc}${path.startsWith('/') ? '' : '/'}${path === '/' ? '' : path}`
  return origin + out + suffix
}

/** Where a non-lead version is served, given only its locale and slug. */
export type ArticleLocalePath = (locale: string, slug: string) => string

/** The default `articleLocalePath`: `localizePath` over the site's own `articlePath`. */
export function defaultArticleLocalePath(articlePath: ArticlePath): ArticleLocalePath {
  return (locale, slug) => {
    const lang = langOfLocale(locale)
    return localizePath(articlePath(lang, slug), lang, locale)
  }
}

/**
 * The site-relative path of one stored version: the lead keeps `articlePath(lang, slug)`, every
 * other version goes through `articleLocalePath` (default: `defaultArticleLocalePath`).
 */
export function articleVersionPath(a: StoredArticle, articlePath: ArticlePath, articleLocalePath?: ArticleLocalePath): string {
  if (isLead(a)) return articlePath(a.lang, a.slug)
  return (articleLocalePath ?? defaultArticleLocalePath(articlePath))(localeOf(a), a.slug)
}

/**
 * hreflang for every version of one externalId (contract 1.20.0):
 *  - every locale maps to its own URL;
 *  - the plain language maps to that language's lead URL;
 *  - `x-default` maps to the first version (the source — the hub sends it first).
 *
 * `legacy` is the 0.1.6 behaviour for a payload with no `locale` at all: `x-default` is `en`
 * when present, else the first language — byte-for-byte what 0.1.6's sitemap printed.
 */
export function articleHreflang(
  versions: StoredArticle[], urlOf: (a: StoredArticle) => string, legacy = false,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of versions) out[localeOf(v)] = urlOf(v)
  for (const v of versions) if (isLead(v)) out[v.lang] = urlOf(v)
  if (!versions.length) return out
  if (legacy) {
    const lang = out.en ? 'en' : Object.keys(out)[0]
    if (lang) out['x-default'] = out[lang]
  } else {
    out['x-default'] = urlOf(versions[0])
  }
  return out
}

export type LocalePrefix = {
  /** The first path segment as it appeared (`ar-ae`, `ar`). */
  segment: string
  /** The language it belongs to (`ar`). */
  lang: string
  /** The canonical locale (`ar-AE`), or null when the segment is a plain language. */
  locale: string | null
  /** The path with the prefix removed, always starting with `/` (`/blog/x`). */
  rest: string
}

/**
 * Splits `/<locale-or-lang>/...` off a pathname. `/ar-ae/blog/x` →
 * `{segment:'ar-ae', lang:'ar', locale:'ar-AE', rest:'/blog/x'}`; `/ar/blog/x` →
 * `{segment:'ar', lang:'ar', locale:null, rest:'/blog/x'}`. Null when the first segment is neither
 * — or, when `supported` is given, when its language is not one of them (so `/blog/x` or
 * `/about` never parses as a language).
 */
export function parseLocalePrefix(pathname: string, supported?: string[]): LocalePrefix | null {
  const path = String(pathname ?? '').split(/[?#]/)[0]
  const m = path.match(/^\/([^/]+)(\/.*)?$/)
  if (!m) return null
  const segment = m[1]
  if (!isLangOrLocale(segment)) return null
  const locale = isLocaleCode(segment) ? canonicalLocale(segment) : null
  const lang = locale ? langOfLocale(locale) : segment.toLowerCase()
  if (supported && !supported.some((s) => s.toLowerCase() === lang || s.toLowerCase() === segment.toLowerCase())) return null
  return { segment, lang, locale, rest: m[2] || '/' }
}
