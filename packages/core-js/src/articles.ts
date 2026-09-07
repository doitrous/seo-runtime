import type { Meta, StoredArticle } from './types.ts'
import type { SeoStore } from './store.ts'
import { intro, renderBody } from './markdown.ts'

export type HubArticle = {
  lang: string; title: string; slug: string
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

export function toStoredArticles(payload: HubPayload, supported: string[]): { skipped: string[]; articles: StoredArticle[] } {
  const skipped: string[] = [], out: StoredArticle[] = []
  const now = new Date().toISOString()
  for (const a of payload.articles) {
    if (!supported.includes(a.lang)) { skipped.push(a.lang); continue }
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
    })
  }
  return { skipped, articles: out }
}

export type IngestResult = {
  /** Anything but 200 is returned as-is: Aspects' 422 publication gate, a receiver's own 409. */
  status?: number
  results: { lang: string; remoteId: string; remoteUrl: string }[]
  skipped: string[]
  /** Extra keys travel through untouched — Aspects also returns `droppedChecklistKeys`. */
  [k: string]: unknown
}

export type IngestOptions = {
  supported: string[]
  urlFor: (lang: string, slug: string) => string
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

  // A slug that already belongs to a DIFFERENT job would silently publish a second article at
  // the same URL, because upsert is keyed on (externalId, lang). Every receiver answers 409 for
  // this today and the hub's adapter reads it as "pick another slug".
  for (const a of articles) {
    const clash = await store.findArticleBySlug(a.lang, a.slug)
    if (clash && clash.externalId !== a.externalId) {
      return { status: 409, body: { error: 'slug_taken', slug: a.slug, lang: a.lang } }
    }
  }

  const results = []
  for (const a of articles) {
    await store.upsertArticle(a)
    results.push({ lang: a.lang, remoteId: `${a.externalId}:${a.lang}`, remoteUrl: opts.urlFor(a.lang, a.slug) })
  }
  return { status: 200, body: { results, skipped } }
}
