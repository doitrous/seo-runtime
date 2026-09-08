import { escapeHtml, jsonLdScript, type ResolvedSeo } from '@omary98/seo-runtime-core'

/**
 * Every attribute and text node is escaped with core's `escapeHtml`; JSON-LD is serialized with
 * core's `jsonLdScript`, which escapes `<` as the six-character backslash-u-0-0-3-c sequence so a
 * `</script>` inside a string value can never close the tag early. Never re-implement that
 * escape here — call the core function.
 */
export function headTags(seo: ResolvedSeo): string {
  const e = escapeHtml
  const alternates = Object.entries(seo.alternates)
    .map(([lang, href]) => `<link rel="alternate" hreflang="${e(lang)}" href="${e(href)}">`).join('')
  const meta = (name: string, content: string, property = false) =>
    content ? `<meta ${property ? 'property' : 'name'}="${e(name)}" content="${e(content)}">` : ''
  return [
    `<title>${e(seo.title)}</title>`,
    meta('description', seo.description),
    seo.canonical ? `<link rel="canonical" href="${e(seo.canonical)}">` : '',
    alternates,
    `<meta name="robots" content="${seo.robots.index ? 'index' : 'noindex'}, ${seo.robots.follow ? 'follow' : 'nofollow'}">`,
    meta('og:title', seo.og.title, true), meta('og:description', seo.og.description, true),
    meta('og:url', seo.canonical, true), meta('og:image', seo.og.image, true),
    meta('twitter:card', seo.twitter.image ? 'summary_large_image' : 'summary'),
    meta('twitter:title', seo.twitter.title), meta('twitter:description', seo.twitter.description),
    meta('twitter:image', seo.twitter.image),
    jsonLdScript(seo.jsonld),
  ].join('')
}

/**
 * For an SPA shell served as a static HTML file: replaces any existing `<title>` and appends the
 * tags just before `</head>`. A document with no `</head>` is returned unchanged — there is
 * nowhere safe to insert the tags, and this is never expected to happen for a real HTML shell.
 */
export function injectHead(html: string, seo: ResolvedSeo): string {
  if (!/<\/head>/i.test(html)) return html
  // A function replacer, not a string one: `String.replace` reads `$&`, `$1`, etc. out of a
  // string replacement, so a hub title containing `$&` would otherwise be spliced into the
  // matched `</head>` text instead of appearing literally.
  return html.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<\/head>/i, () => `${headTags(seo)}</head>`)
}
