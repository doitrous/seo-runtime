import type { Author, HelpEntry, Settings, Tool, Verification } from './types.ts'
import { normalizePath } from './types.ts'
import { isSchemaOrg } from './resolve.ts'
import { xmlEscape } from './sitemap.ts'

// No node: imports here — this module is re-exported from both the full barrel (index.ts) and
// the edge barrel (edge.ts), same as resolve.ts/redirects.ts/sitemap.ts/robots.ts.

export function findAuthor(settings: Settings, slug: string): Author | null {
  return settings.authors?.find((a) => a.slug === slug) ?? null
}

export function findHelpEntry(settings: Settings, slug: string, lang: string): HelpEntry | null {
  return settings.helpEntries?.find((h) => h.slug === slug && h.lang === lang) ?? null
}

export function findTool(settings: Settings, slug: string, lang: string): Tool | null {
  return settings.tools?.find((t) => t.slug === slug && t.lang === lang) ?? null
}

/** The site-wide entity block for `/` and `/about`. Dropped unless it is schema.org-shaped. */
export function entityJsonLd(settings: Settings): Record<string, unknown> | null {
  const e = settings.entity
  return e && isSchemaOrg(e) ? e : null
}

export function personJsonLd(author: Author, canonical: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org', '@type': 'Person', '@id': `${canonical}#person`,
    name: author.name, url: canonical,
    ...(author.title ? { jobTitle: author.title } : {}),
    ...(author.credentials ? { honorificSuffix: author.credentials } : {}),
    ...(author.bio ? { description: author.bio } : {}),
    ...(author.sameAs?.length ? { sameAs: author.sameAs } : {}),
  }
}

/** `Article` per the ticket — headline is the question, dateModified from `updatedAt`. */
export function helpArticleJsonLd(entry: HelpEntry, canonical: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org', '@type': 'Article', '@id': `${canonical}#article`,
    headline: entry.question, url: canonical, mainEntityOfPage: canonical,
    inLanguage: entry.lang, dateModified: entry.updatedAt,
    ...(entry.moneyPageUrl ? { about: entry.moneyPageUrl } : {}),
  }
}

export function toolJsonLd(tool: Tool, canonical: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org', '@type': 'WebApplication', '@id': `${canonical}#tool`,
    name: tool.kind, url: canonical, applicationCategory: tool.kind, inLanguage: tool.lang,
    ...(tool.dataSource ? { creator: { '@type': 'Organization', name: tool.dataSource } } : {}),
    ...(tool.asOf ? { dateModified: tool.asOf } : {}),
  }
}

export function authorBodyHtml(author: Author): string {
  const e = xmlEscape
  return `<h1>${e(author.name)}</h1>` +
    (author.title ? `<p class="seo-author-title">${e(author.title)}</p>` : '') +
    (author.credentials ? `<p class="seo-author-credentials">${e(author.credentials)}</p>` : '') +
    (author.bio ? `<p class="seo-author-bio">${e(author.bio)}</p>` : '') +
    (author.sameAs?.length
      ? `<ul class="seo-author-same-as">${author.sameAs.map((u) => `<li><a href="${e(u)}" rel="me">${e(u)}</a></li>`).join('')}</ul>`
      : '')
}

/** Question as `<h1>`, answer first — `answerHtml` is pre-rendered, trusted HTML from the hub. */
export function helpBodyHtml(entry: HelpEntry): string {
  const e = xmlEscape
  return `<h1>${e(entry.question)}</h1>` +
    `<div class="seo-help-answer">${entry.answerHtml}</div>` +
    (entry.moneyPageUrl ? `<p class="seo-help-cta"><a href="${e(entry.moneyPageUrl)}">Learn more</a></p>` : '')
}

/**
 * A placeholder container plus the methodology block — the interactive kit itself ships
 * separately (per the ticket) and mounts into `#seo-tool-{slug}` at runtime.
 */
export function toolBodyHtml(tool: Tool): string {
  const e = xmlEscape
  const config = JSON.stringify(tool.config ?? {})
  return `<h1>${e(tool.kind)}</h1>` +
    `<div id="seo-tool-${e(tool.slug)}" class="seo-tool-placeholder" data-kind="${e(tool.kind)}" data-config="${e(config)}"></div>` +
    (tool.methodologyHtml ? `<div class="seo-tool-methodology">${tool.methodologyHtml}</div>` : '') +
    (tool.dataSource
      ? `<p class="seo-tool-data-source">Data source: ${e(tool.dataSource)}${tool.asOf ? ` (as of ${e(tool.asOf)})` : ''}</p>`
      : '')
}

export function verificationMetaTags(v: Verification | undefined): string {
  if (!v) return ''
  const e = xmlEscape
  return (v.googleMeta ? `<meta name="google-site-verification" content="${e(v.googleMeta)}">` : '') +
    (v.bingMeta ? `<meta name="msvalidate.01" content="${e(v.bingMeta)}">` : '')
}

const SAFE_GA4_ID = /^[A-Za-z0-9_-]+$/

/** Dropped rather than escaped when malformed: the id sits inside a JS string literal, not an attribute. */
export function gtagSnippet(measurementId: string | undefined): string {
  if (!measurementId || !SAFE_GA4_ID.test(measurementId)) return ''
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());gtag('config','${measurementId}');</script>`
}

/** `/{key}.txt` served with the key as the body, or null when `path` doesn't match. */
export function indexNowKeyFile(settings: Settings, path: string): string | null {
  const key = settings.indexNowKey
  if (!key) return null
  return normalizePath(path) === `/${key}.txt` ? key : null
}

/**
 * The opt-in web-vitals beacon (packages/CONTRACT.md's v2 IndexNow/vitals section): a site
 * includes this itself (it is never wired into headTags/injectHead the way gtagSnippet is,
 * since not every site wants a beacon on every page) and it never carries this site's own
 * secret — a real visitor's browser is not a place to keep one. It posts LCP/CLS/best-effort INP
 * to this site's own same-origin `POST /api/seo/vitals`, which is the one that attaches the
 * secret server-side and relays to the hub (`submitVitals`, in approval.ts). No `web-vitals`
 * dependency: every metric here comes straight off `PerformanceObserver`, which is all that
 * library itself wraps for these three entry types, and each observe() call is its own try/catch
 * so a browser missing one entry type (Safari has no `event` timing yet) still reports the rest.
 */
export function webVitalsSnippet(): string {
  return '<script>(function(){try{' +
    "var m={lcp:0,inp:0,cls:0};" +
    "try{new PerformanceObserver(function(l){var es=l.getEntries();if(es.length)m.lcp=es[es.length-1].startTime;})" +
    ".observe({type:'largest-contentful-paint',buffered:true});}catch(e){}" +
    "try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)m.cls+=e.value;});})" +
    ".observe({type:'layout-shift',buffered:true});}catch(e){}" +
    "try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.duration>m.inp)m.inp=e.duration;});})" +
    ".observe({type:'event',buffered:true,durationThreshold:40});}catch(e){}" +
    "function send(){try{navigator.sendBeacon('/api/seo/vitals',JSON.stringify({url:location.href,lcp:m.lcp,inp:m.inp,cls:m.cls}));}catch(e){}}" +
    "document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')send();});" +
    'addEventListener("pagehide",send);' +
    '}catch(e){}})();</script>'
}
