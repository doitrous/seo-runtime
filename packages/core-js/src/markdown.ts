import { Marked } from 'marked'

/**
 * The same escaper the sitemap uses — one implementation, two names. `&apos;` is valid in HTML5
 * and in XML, so there is no reason to keep a second copy that differs only in emitting `&#39;`.
 */
export { xmlEscape as escapeHtml } from './sitemap.ts'
import { xmlEscape as escapeHtml } from './sitemap.ts'

const SAFE_TARGET = /^(https?:\/\/|\/(?!\/)|#)/i

/**
 * Renderer-level guards, proven in the phase-3 receivers:
 *  - `html` covers both block and inline HTML tokens in marked v15, so escaping there means no
 *    raw markup ever reaches the page, however it is spelled (`<scr<script>ipt>` included).
 *    A source-level regex strip does not close that hole.
 *  - link/image hrefs are checked after marked has unwrapped CommonMark's `<...>` destinations,
 *    which is what `[x](<javascript:…>)` uses to slip past a source regex.
 */
const safeMarked = new Marked({
  renderer: {
    html(token) { return escapeHtml(token.text) },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const target = String(href ?? '').trim()
      if (!SAFE_TARGET.test(target)) return text
      return `<a href="${escapeHtml(target)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>`
    },
    image({ href, title, text }) {
      const target = String(href ?? '').trim()
      if (!SAFE_TARGET.test(target)) return ''
      return `<img src="${escapeHtml(target)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`
    },
  },
})

/** Anchored to the start (no /m) so only a genuinely leading H1 is dropped. */
export function renderBody(md: string): string {
  const html = safeMarked.parse(String(md ?? '').replace(/^\s*# .*\n?/, ''), { async: false }) as string
  return html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" rel="noopener" target="_blank"')
}

export function intro(md: string): string {
  const p = String(md ?? '').replace(/^\s*# .*\n?/, '').split(/\n{2,}/).map((x) => x.trim()).find((x) => x && !x.startsWith('#')) ?? ''
  return p.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '').trim()
}

/** `<` escaped so a literal "</script>" inside a string value cannot close the tag. */
/** One JSON-LD entry as script text: `<` becomes `\\u003c` so `</script>` cannot break out. */
export function jsonLdBody(entry: Record<string, unknown>): string {
  return JSON.stringify(entry).replace(/</g, '\\u003c')
}

export function jsonLdScript(entries: Record<string, unknown>[]): string {
  return entries.map((e) => `<script type="application/ld+json">${jsonLdBody(e)}</script>`).join('')
}
