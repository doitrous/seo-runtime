import type { Author, HelpEntry, Settings, Tool, Verification } from './types.ts'
import { normalizePath } from './types.ts'
import { isSchemaOrg } from './resolve.ts'
import { xmlEscape } from './sitemap.ts'
import { jsonLdScript } from './markdown.ts'

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

function toolPlaceholderDiv(tool: Tool): string {
  const e = xmlEscape
  const config = JSON.stringify(tool.config ?? {})
  return `<div id="seo-tool-${e(tool.slug)}" class="seo-tool-placeholder" data-kind="${e(tool.kind)}" data-config="${e(config)}"></div>`
}

/** Every kind's config carries a `title`; fall back to the slug (ported from site-template's `toolTitle`). */
function toolTitle(tool: Tool): string {
  return typeof tool.config?.title === 'string' && tool.config.title ? tool.config.title : tool.slug
}

export type EmbedOptions = { origin: string; slug: string; lang: string; title: string; siteName: string }

/**
 * The paste-anywhere snippet shown under a tool page — ported byte-for-byte from site-template's
 * `packages/tools/embed.ts` so every stack's embed markup matches. The `<p>` outside the iframe
 * is the point: a crawlable link back to the tool page and the home page, since an iframe alone
 * passes no link equity. The tool link stays followed (editorial attribution); the brand link is
 * a pure widget credit and is `rel="nofollow"` per Google's link-spam policy. The `<script>` only
 * resizes an iframe pointed at this same origin — never an ad or chat widget.
 */
export function embedSnippet({ origin, slug, lang, title, siteName }: EmbedOptions): string {
  const e = xmlEscape
  // The hub-supplied slug is untrusted: encodeURIComponent so a quote in it can never break out
  // of the src/href attribute it lands in below.
  const page = `${origin}/tools/${encodeURIComponent(slug)}`
  return [
    `<iframe src="${page}/embed?lang=${encodeURIComponent(lang)}" title="${e(title)}" width="100%" height="480" style="border:0;max-width:100%" loading="lazy"></iframe>`,
    `<p><a href="${page}">${e(title)}</a> — a free tool by <a href="${origin}/" rel="nofollow">${e(siteName)}</a></p>`,
    `<script>addEventListener("message",function(e){var h=Number(e.data&&e.data.seoToolHeight);if(!h)return;document.querySelectorAll('iframe[src^="${origin}/"]').forEach(function(f){if(f.contentWindow===e.source)f.style.height=h+"px"})})</script>`,
  ].join('\n')
}

/**
 * A placeholder container plus the methodology block — the interactive kit itself ships
 * separately (per the ticket) and mounts into `#seo-tool-{slug}` at runtime, via `/seo-tools.js`
 * (the site copies `public/seo-tools.js` from site-template; see the package README).
 *
 * `ctx` is optional so existing call sites keep compiling: on a cold store there is no origin to
 * build an absolute embed URL from, so the "Embed this calculator" section is omitted entirely
 * rather than emitting a broken relative iframe src.
 */
export function toolBodyHtml(tool: Tool, ctx?: { origin: string; siteName: string }): string {
  const e = xmlEscape
  const embed = ctx?.origin
    ? `<h2>Embed this calculator</h2><textarea readonly rows="6">${e(embedSnippet({
        origin: ctx.origin, slug: tool.slug, lang: tool.lang, title: toolTitle(tool), siteName: ctx.siteName,
      }))}</textarea>`
    : ''
  return `<h1>${e(tool.kind)}</h1>` +
    toolPlaceholderDiv(tool) +
    (tool.methodologyHtml ? `<div class="seo-tool-methodology">${tool.methodologyHtml}</div>` : '') +
    (tool.dataSource
      ? `<p class="seo-tool-data-source">Data source: ${e(tool.dataSource)}${tool.asOf ? ` (as of ${e(tool.asOf)})` : ''}</p>`
      : '') +
    embed +
    '<script src="/seo-tools.js" defer></script>'
}

/**
 * The iframe-able view of a tool: the calculator placeholder, a link back to the full page, the
 * calculator bundle, and the inline ResizeObserver postMessage script — ported byte-for-byte from
 * site-template's `app/tools/[slug]/embed/page.tsx`. `target="_top"` on the link so it navigates
 * the host page, not the iframe.
 */
export function toolEmbedHtml(tool: Tool, ctx: { canonical: string; siteName: string }): string {
  const e = xmlEscape
  return toolPlaceholderDiv(tool) +
    `<p><a href="${e(ctx.canonical)}" target="_top">Full calculator, methodology and FAQ at ${e(ctx.siteName)}</a></p>` +
    '<script src="/seo-tools.js" defer></script>' +
    '<script>new ResizeObserver(function(){parent.postMessage({seoToolHeight:document.documentElement.scrollHeight},\'*\')}).observe(document.body)</script>'
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
/**
 * `/help` index (06-help-page.md): every entry for `lang`, a client-side filter box, and a
 * FAQPage block for the first 10 questions. `HelpEntry` carries no topic field (that stays hub
 * side, per the ticket), so "grouped" here is one flat, filterable list rather than the topic
 * buckets the doc sketches.
 * ponytail: flat list, not grouped by topic — upgrade to real groups (before you book, cost and
 * payment, travel, aftercare, …) once `HelpEntry` gains a `topic` field on the hub side; render
 * one `<h2>` heading per distinct topic instead of a single flat `<ul>`.
 */
export function helpIndexBodyHtml(settings: Settings, lang: string): string {
  const e = xmlEscape
  const entries = (settings.helpEntries ?? []).filter((h) => h.lang === lang)
  // The slug and lang are hub-supplied strings, not developer-authored config: encodeURIComponent
  // first so a quote or `?`/`&` in either can never break out of the href it lands in, then
  // xmlEscape as usual for the HTML attribute itself (belt and braces, same split embedSnippet
  // uses for a tool slug).
  const list = entries.length
    ? `<ul class="seo-help-index">${entries.map((h) =>
        `<li><a href="${e(`/help/${encodeURIComponent(h.slug)}?lang=${encodeURIComponent(lang)}`)}">${e(h.question)}</a></li>`).join('')}</ul>`
    : '<p>No help entries yet.</p>'
  const faq = entries.slice(0, 10).map((h) => ({
    '@type': 'Question', name: h.question, acceptedAnswer: { '@type': 'Answer', text: h.answerHtml },
  }))
  const faqJsonLd = faq.length
    ? jsonLdScript([{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }])
    : ''
  return '<h1>Help</h1>' +
    '<input type="search" id="seo-help-search" placeholder="Search help" aria-label="Search help">' +
    list +
    // Tiny inline filter: hides list items whose text doesn't match, never generates the links.
    '<script>(function(){var i=document.getElementById("seo-help-search");var items=document.querySelectorAll(".seo-help-index li");' +
    'if(!i)return;i.addEventListener("input",function(){var q=i.value.toLowerCase();' +
    'items.forEach(function(li){li.hidden=q!==""&&li.textContent.toLowerCase().indexOf(q)===-1})})})();</script>' +
    faqJsonLd
}

/** `/editorial-guidelines` (01-site-setup.md). `editorialGuidelinesHtml` is pre-rendered, trusted HTML from the hub — rendered as-is, like a help entry's `answerHtml`. */
export function editorialBodyHtml(settings: Settings): string {
  const html = settings.editorialGuidelinesHtml?.trim()
  return '<h1>Editorial guidelines</h1>' + (html || '<p>Editorial guidelines are not published yet.</p>')
}

/**
 * hreflang for the five locale-free routes this package renders itself (`/help`,
 * `/help/{slug}`, `/editorial-guidelines`, `/authors/{slug}`, `/tools/{slug}`): matched by
 * `?lang=`, not a path segment, so `resolveSeo`'s page-group `alternates` — built from stored
 * `SnapshotPage` rows — are always empty for these paths; there is no page record to group by.
 * `path` is the bare path with no query. The current language's own URL stays the page's
 * `canonical` (computed separately by `resolveSeo`); this only supplies the reciprocal set.
 * Never used on `/tools/{slug}/embed`, which stays canonical-only (`noindex`).
 */
export function localeFreeAlternates(supported: string[], path: string): Record<string, string> {
  const p = normalizePath(path)
  const out: Record<string, string> = {}
  for (const lang of supported) out[lang] = `${p}?lang=${encodeURIComponent(lang)}`
  if (supported.length) out['x-default'] = out[supported[0]]
  return out
}

export type ShareLinks = { url: string; title: string }

/**
 * 01-site-setup.md §5 / packages/CONTRACT.md: server-rendered share links (WhatsApp, X, Facebook,
 * LinkedIn, copy-link) so the block works with no JS at all; the inline script only upgrades the
 * "Share" button to `navigator.share()` when the browser has it (mobile), per the ticket's own
 * working-style note — never the other way round.
 */
export function shareBlockHtml({ url, title }: ShareLinks): string {
  const e = xmlEscape
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(title)
  const links: [string, string][] = [
    ['WhatsApp', `https://wa.me/?text=${t}%20${u}`],
    ['X', `https://twitter.com/intent/tweet?text=${t}&url=${u}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
  ]
  const anchors = links.map(([label, href]) => `<a href="${href}" rel="noopener" target="_blank">${e(label)}</a>`).join('')
  return `<div class="seo-share">` +
    `<button type="button" id="seo-share-native" hidden data-url="${e(url)}" data-title="${e(title)}">Share</button>` +
    anchors +
    `<button type="button" data-share-copy="${e(url)}">Copy link</button>` +
    `</div>` +
    '<script>(function(){var n=document.getElementById("seo-share-native");' +
    'if(navigator.share&&n){n.hidden=false;n.addEventListener("click",function(){navigator.share({title:n.dataset.title,url:n.dataset.url}).catch(function(){})})}' +
    'document.querySelectorAll("[data-share-copy]").forEach(function(b){b.addEventListener("click",function(){' +
    'navigator.clipboard&&navigator.clipboard.writeText(b.dataset.shareCopy).catch(function(){})})})})();</script>'
}

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
