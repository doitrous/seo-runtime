import type { Meta, StoredArticle } from './types.ts'
import type { SeoStore } from './store.ts'
import { intro, renderBody } from './markdown.ts'
import {
  articleHreflang, canonicalLocale, isLead, isLocaleCode, langOfLocale, localeOf, localizePath,
  withVersionDefaults,
} from './locale.ts'

export type HubArticle = {
  lang: string; title: string; slug: string
  /**
   * Hub contract 1.20.0: the version's locale (`ar-AE`). Sent on every item by a current hub;
   * absent from an older one, in which case the version's locale is its `lang` and everything
   * behaves exactly as 0.1.6. Several items may share a `lang` (one per country) when the site's
   * `localeUrls` flag is on; the first of each language is its lead.
   */
  locale?: string
  metaTitle?: string; metaDescription?: string; bodyMd: string
  faq?: { q: string; a: string }[]; schemaJsonld?: Record<string, unknown>[]; hreflang?: Record<string, string>
  // spec 1 additions; all optional so an older hub still ingests
  introduction?: string; secondaryKeywords?: string[]; searchIntent?: string
  og?: { title?: string; description?: string }
  references?: { title: string; url: string; publisher?: string; date?: string }[]
  sections?: Record<string, unknown>
}

export type HubPayload = {
  externalId: number
  author?: { name?: string; credentials?: string; bio?: string; photoUrl?: string }
  image?: { url: string; alt?: string } | null
  reviewer?: { name?: string; credentials?: string; bio?: string }
  reviewedAt?: { medical?: string; seo?: string }
  checklist?: Record<string, unknown>
  cta?: { text?: string; url?: string }
  plannedUpdateAt?: string
  articles: HubArticle[]
}

const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0

/**
 * Deliberately NOT ASCII kebab-case. Aspects serves Arabic slugs and its own receiver only ever
 * required a non-empty string, so an `^[a-z0-9-]+$` rule would turn payloads the hub has been
 * sending since spec 1 into 400s. What actually has to be refused is a slug that cannot sit in a
 * URL path segment: whitespace, a path separator, a query or fragment marker, or a traversal.
 */
const BAD_SLUG = /[\s/\\?#]|(^|\/)\.\.($|\/)/
const badSlug = (slug: string) => !slug || slug.length > 191 || BAD_SLUG.test(slug) || slug.includes('..')

export function validatePayload(body: unknown): { payload: HubPayload } | { error: string } {
  const b = body as Record<string, unknown> | null
  if (!b || !Number.isInteger(b.externalId)) return { error: 'invalid externalId' }
  if (!Array.isArray(b.articles) || b.articles.length === 0) return { error: 'invalid articles' }
  for (const [i, raw] of (b.articles as Record<string, unknown>[]).entries()) {
    const a = raw ?? {}
    for (const k of ['lang', 'title', 'slug', 'bodyMd']) if (!str(a[k])) return { error: `invalid articles[${i}].${k}` }
    if (badSlug((a.slug as string).trim())) return { error: `invalid articles[${i}].slug` }
    if ((a.title as string).length > 500) return { error: `invalid articles[${i}].title` }
    if (a.faq !== undefined && (!Array.isArray(a.faq) || a.faq.some((f) => !str((f as Record<string, unknown>)?.q) || !str((f as Record<string, unknown>)?.a))))
      return { error: `invalid articles[${i}].faq` }
    if (a.schemaJsonld !== undefined && !Array.isArray(a.schemaJsonld)) return { error: `invalid articles[${i}].schemaJsonld` }
    if (a.locale !== undefined && a.locale !== null) {
      // The language part must be the item's own language: `ar-AE` under `lang: 'ar'`.
      const loc = a.locale, lang = String(a.lang)
      const ok = typeof loc === 'string' && (canonicalLocale(loc) === canonicalLocale(lang)
        || (isLocaleCode(loc) && langOfLocale(loc) === langOfLocale(lang)))
      if (!ok) return { error: `invalid articles[${i}].locale` }
    }
    if (a.references !== undefined && (!Array.isArray(a.references) || a.references.some((r) => !str((r as Record<string, unknown>)?.url))))
      return { error: `invalid articles[${i}].references` }
  }
  if (b.image != null && (typeof b.image !== 'object' || !str((b.image as Record<string, unknown>).url))) return { error: 'invalid image' }
  return { payload: b as unknown as HubPayload }
}

/** Cuts at the last word boundary before `max`, so a description never ends mid-word. */
const clip = (text: string, max: number) => {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')
}

/** The item's locale: its own `locale` when sent, else its `lang` (0.1.6 behaviour). */
const itemLocale = (a: HubArticle) => (typeof a.locale === 'string' && a.locale.trim() ? canonicalLocale(a.locale) : a.lang)

export function toStoredArticles(payload: HubPayload, supported: string[]): { skipped: string[]; articles: StoredArticle[] } {
  const skipped: string[] = [], out: StoredArticle[] = []
  const now = new Date().toISOString()
  // The lead of each language is its first item in the payload (the hub sends the source first,
  // then market order). A later item carrying the lead's own locale is the same version again.
  const leadLocale = new Map<string, string>()
  for (const a of payload.articles) {
    if (!supported.includes(a.lang)) { skipped.push(a.lang); continue }
    const locale = itemLocale(a)
    if (!leadLocale.has(a.lang)) leadLocale.set(a.lang, locale)
    const lead = leadLocale.get(a.lang) === locale
    const og: Meta = { title: a.og?.title ?? '', description: a.og?.description ?? '', image: payload.image?.url ?? '' }
    const lede = a.introduction?.trim() || intro(a.bodyMd)
    out.push({
      externalId: payload.externalId, lang: a.lang, slug: a.slug.trim(), title: a.title,
      metaTitle: a.metaTitle?.trim() || a.title,
      metaDescription: a.metaDescription?.trim() || clip(lede, 155),
      bodyMd: a.bodyMd, bodyHtml: renderBody(a.bodyMd),
      faq: a.faq ?? [], schemaJsonld: a.schemaJsonld ?? [],
      imageUrl: payload.image?.url ?? null, imageAlt: payload.image?.alt ?? null,
      authorName: payload.author?.name ?? null, authorCredentials: payload.author?.credentials ?? null,
      references: (a.references ?? []).map((r) => ({ title: r.title, url: r.url })),
      og,
      // Everything spec 1 sends that has no column. Dropping these is what would make Nishany
      // (whose articles live in this store) go backwards on the very fields spec 1 added.
      extra: {
        ...(payload.reviewer ? { reviewer: payload.reviewer } : {}),
        ...(payload.reviewedAt ? { reviewedAt: payload.reviewedAt } : {}),
        ...(payload.checklist ? { checklist: payload.checklist } : {}),
        ...(payload.cta ? { cta: payload.cta } : {}),
        ...(payload.plannedUpdateAt ? { plannedUpdateAt: payload.plannedUpdateAt } : {}),
        ...(a.secondaryKeywords ? { secondaryKeywords: a.secondaryKeywords } : {}),
        ...(a.searchIntent ? { searchIntent: a.searchIntent } : {}),
        ...(a.sections ? { sections: a.sections } : {}),
        ...(a.introduction ? { introduction: a.introduction } : {}),
      },
      publishedAt: now, updatedAt: now,
      locale, lead, hreflang: {},
    })
  }
  return { skipped, articles: out }
}

export type IngestResult = {
  /** Anything but 200 is returned as-is: Aspects' 422 publication gate, a receiver's own 409. */
  status?: number
  results: { lang: string; locale?: string; remoteId: string; remoteUrl: string }[]
  skipped: string[]
  /** Extra keys travel through untouched — Aspects also returns `droppedChecklistKeys`. */
  [k: string]: unknown
}

export type IngestOptions = {
  supported: string[]
  urlFor: (lang: string, slug: string) => string
  /**
   * Where a non-lead version is served (absolute URL), given its canonical locale (`ar-AE`) and
   * slug. Defaults to `urlFor(lang, slug)` with the language segment replaced by the lowercase
   * locale (`…/ar/blog/x` → `…/ar-ae/blog/x`), or `/<locale>` prepended to a default language
   * served unprefixed (`…/blog/x` → `…/en-us/blog/x`) — see `localizePath`.
   */
  urlForLocale?: (locale: string, slug: string) => string
  /**
   * A site that keeps its own CMS as the renderer takes over storage here. The hook's result is
   * returned verbatim, including a `status` it asks for — without that channel Aspects' 422
   * publication gate and the receivers' 409 turn into 500s, and the hub loses the ability to tell
   * "pick another slug" apart from "the site is down".
   */
  onArticle?: (payload: HubPayload) => Promise<IngestResult>
}

export async function ingestArticles(store: SeoStore, body: unknown, opts: IngestOptions): Promise<{ status: number; body: unknown }> {
  const v = validatePayload(body)
  if ('error' in v) return { status: 400, body: { error: v.error } }

  if (opts.onArticle) {
    try {
      const { status = 200, ...rest } = await opts.onArticle(v.payload)
      return { status, body: rest }
    } catch (e) {
      // A hook that throws is the site's bug, not a crash of the route. Every receiver today
      // maps its own duplicate-key error to a 409, so recognise that shape and keep the code.
      const err = e as { code?: string; status?: number; message?: string }
      if (err?.code === 'P2002' || err?.code === 'ER_DUP_ENTRY' || err?.status === 409) {
        return { status: 409, body: { error: 'slug_taken' } }
      }
      return { status: 500, body: { error: 'article_hook_failed', message: String(err?.message ?? e) } }
    }
  }

  const { skipped, articles } = toStoredArticles(v.payload, opts.supported)
  if (!articles.length) return { status: 400, body: { error: 'no supported languages' } }

  const urlForLocale = opts.urlForLocale
    ?? ((locale: string, slug: string) => localizePath(opts.urlFor(langOfLocale(locale), slug), langOfLocale(locale), locale))
  const urlOf = (a: StoredArticle) => (isLead(a) ? opts.urlFor(a.lang, a.slug) : urlForLocale(localeOf(a), a.slug))

  // A slug that already belongs to a DIFFERENT job would silently publish a second article at
  // the same URL, because upsert is keyed on (externalId, locale). Every receiver answers 409 for
  // this today and the hub's adapter reads it as "pick another slug". Checked per URL space: a
  // lead against its language's leads, any other version against its own locale.
  for (const a of articles) {
    const clash = await store.findArticleBySlug(isLead(a) ? a.lang : localeOf(a), a.slug)
    if (clash && clash.externalId !== a.externalId) {
      return { status: 409, body: { error: 'slug_taken', slug: a.slug, lang: a.lang, ...(isLead(a) ? {} : { locale: localeOf(a) }) } }
    }
  }

  // hreflang is computed from every version this site will hold for the externalId once this
  // payload lands: the payload's own versions first (in payload order — the source is first),
  // then any version stored earlier that the payload does not replace.
  const externalId = v.payload.externalId
  const stored = (typeof store.listArticleVersions === 'function'
    ? await store.listArticleVersions(externalId)
    : typeof store.listArticles === 'function'
      ? (await store.listArticles()).filter((x) => x.externalId === externalId)
      : []).map(withVersionDefaults)
  const incoming: StoredArticle[] = []
  for (const a of articles) {
    const i = incoming.findIndex((x) => localeOf(x) === localeOf(a))
    if (i >= 0) incoming[i] = a; else incoming.push(a)
  }
  const replaced = (old: StoredArticle) => incoming.some((a) =>
    localeOf(a) === localeOf(old) || (isLead(a) && isLead(old) && a.lang === old.lang))
  const untouched = stored.filter((old) => !replaced(old))
  const versions = [...incoming, ...untouched]
  const legacy = !v.payload.articles.some((a) => typeof a.locale === 'string' && a.locale.trim())
  const hreflang = articleHreflang(versions, urlOf, legacy)

  const results = []
  for (const a of articles) {
    await store.upsertArticle({ ...a, hreflang })
    const lead = isLead(a)
    const item = v.payload.articles.find((x) => x.lang === a.lang && itemLocale(x) === localeOf(a))
    results.push({
      lang: a.lang,
      // Only echoed when the hub sent one, so a 0.1.6-shaped payload gets a 0.1.6-shaped answer.
      ...(typeof item?.locale === 'string' && item.locale.trim() ? { locale: item.locale } : {}),
      remoteId: lead ? `${a.externalId}:${a.lang}` : `${a.externalId}:${localeOf(a)}`,
      remoteUrl: urlOf(a),
    })
  }
  // Versions stored by an earlier payload keep their content; only their hreflang moves.
  for (const old of untouched) {
    if (JSON.stringify(old.hreflang ?? {}) !== JSON.stringify(hreflang)) await store.upsertArticle({ ...old, hreflang })
  }
  return { status: 200, body: { results, skipped } }
}

/**
 * The host site's article lookup for routing. `langOrLocale` is the first path segment of the
 * request (`parseLocalePrefix(pathname)`): a plain language (`ar`) returns that language's lead,
 * a locale (`ar-ae` / `ar-AE`) returns the version stored under that locale. A locale that names
 * a language's lead returns null — the lead is served at the language URL, and answering the
 * locale URL too would publish the same article twice.
 */
export async function getArticle(store: SeoStore, langOrLocale: string, slug: string): Promise<StoredArticle | null> {
  const key = String(langOrLocale ?? '').trim()
  if (!key || !slug) return null
  const found = await store.findArticleBySlug(key, slug)
  if (!found) return null
  const a = withVersionDefaults(found)
  if (isLead(a)) return a.lang.toLowerCase() === key.toLowerCase() ? a : null
  return localeOf(a) === canonicalLocale(key) ? a : null
}
