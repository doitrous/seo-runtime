import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorBodyHtml, embedSnippet, entityJsonLd, findAuthor, findHelpEntry, findTool, gtagSnippet,
  helpArticleJsonLd, helpBodyHtml, indexNowKeyFile, personJsonLd, toolBodyHtml, toolEmbedHtml,
  toolJsonLd, verificationMetaTags, webVitalsSnippet,
} from './entities.ts'
import { EMPTY_SETTINGS } from './types.ts'
import type { Settings } from './types.ts'
import { robotsTxt } from './robots.ts'
import type { Snapshot } from './types.ts'

const author = { slug: 'jane', name: 'Jane Doe', title: 'Editor', credentials: 'MD', sameAs: ['https://x.example/jane'], bio: 'Bio.' }
const helpEntry = { slug: 'refund', lang: 'en', question: 'How do refunds work?', answerHtml: '<p>Answer.</p>', moneyPageUrl: '/pricing', updatedAt: '2026-09-01T00:00:00.000Z' }
const tool = { slug: 'calc', lang: 'en', kind: 'Calculator', config: { steps: 3 }, methodologyHtml: '<p>Method.</p>', dataSource: 'ONS', asOf: '2026-08-01' }

test('findAuthor/findHelpEntry/findTool look up by slug (and lang for the latter two)', () => {
  const s: Settings = { ...EMPTY_SETTINGS, authors: [author], helpEntries: [helpEntry], tools: [tool] }
  assert.equal(findAuthor(s, 'jane')?.name, 'Jane Doe')
  assert.equal(findAuthor(s, 'nope'), null)
  assert.equal(findHelpEntry(s, 'refund', 'en')?.question, 'How do refunds work?')
  assert.equal(findHelpEntry(s, 'refund', 'ar'), null)
  assert.equal(findTool(s, 'calc', 'en')?.kind, 'Calculator')
})

test('entity JSON-LD is kept only when schema.org-shaped', () => {
  assert.equal(entityJsonLd({ ...EMPTY_SETTINGS, entity: { '@context': 'https://schema.org', '@type': 'MedicalOrganization' } })?.['@type'], 'MedicalOrganization')
  assert.equal(entityJsonLd({ ...EMPTY_SETTINGS, entity: { name: 'no context' } }), null)
  assert.equal(entityJsonLd(EMPTY_SETTINGS), null)
})

test('personJsonLd carries the optional fields only when present', () => {
  const jsonld = personJsonLd(author, 'https://site/authors/jane')
  assert.equal(jsonld['@type'], 'Person')
  assert.equal(jsonld.name, 'Jane Doe')
  assert.equal(jsonld.jobTitle, 'Editor')
  assert.deepEqual(jsonld.sameAs, ['https://x.example/jane'])
  const bare = personJsonLd({ ...author, title: '', credentials: '', bio: '', sameAs: [] }, 'https://site/authors/jane')
  assert.equal('jobTitle' in bare, false)
  assert.equal('sameAs' in bare, false)
})

test('helpArticleJsonLd is an Article with the question as headline and dateModified set', () => {
  const jsonld = helpArticleJsonLd(helpEntry, 'https://site/help/refund')
  assert.equal(jsonld['@type'], 'Article')
  assert.equal(jsonld.headline, 'How do refunds work?')
  assert.equal(jsonld.dateModified, '2026-09-01T00:00:00.000Z')
  assert.equal(jsonld.about, '/pricing')
})

test('toolJsonLd is a WebApplication', () => {
  const jsonld = toolJsonLd(tool, 'https://site/tools/calc')
  assert.equal(jsonld['@type'], 'WebApplication')
  assert.equal(jsonld.dateModified, '2026-08-01')
})

test('authorBodyHtml escapes plain fields and renders sameAs links', () => {
  const html = authorBodyHtml({ ...author, name: '<script>x</script>' })
  assert.doesNotMatch(html, /<script>x<\/script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /<h1>/)
})

test('helpBodyHtml puts the question in an h1 and the answer first, verbatim HTML', () => {
  const html = helpBodyHtml(helpEntry)
  assert.match(html, /^<h1>How do refunds work\?<\/h1>/)
  assert.match(html, /<p>Answer\.<\/p>/)
  assert.match(html, /href="\/pricing"/)
})

test('toolBodyHtml renders a placeholder container and the methodology block', () => {
  const html = toolBodyHtml(tool)
  assert.match(html, /id="seo-tool-calc"/)
  assert.match(html, /<p>Method\.<\/p>/)
  assert.match(html, /Data source: ONS/)
  assert.match(html, /<script src="\/seo-tools\.js" defer><\/script>/)
})

test('toolBodyHtml omits the embed section on a cold store (no origin) but keeps it once one is set', () => {
  assert.doesNotMatch(toolBodyHtml(tool), /Embed this calculator/)
  const html = toolBodyHtml(tool, { origin: 'https://site.test', siteName: 'Site Co' })
  assert.match(html, /Embed this calculator/)
  assert.match(html, /<textarea readonly rows="6">/)
})

test('embedSnippet nofollows the brand link and scopes its resize listener to iframes on this origin', () => {
  const html = embedSnippet({ origin: 'https://site.test', slug: 'calc', lang: 'en', title: 'Calculator', siteName: 'Site Co' })
  assert.match(html, /<a href="https:\/\/site\.test\/" rel="nofollow">Site Co<\/a>/)
  assert.match(html, /iframe\[src\^="https:\/\/site\.test\/"\]/)
})

test('embedSnippet encodes a hub-supplied slug so a quote in it can never break out of the src/href attribute', () => {
  const html = embedSnippet({ origin: 'https://site.test', slug: 'calc"><script>x</script>', lang: 'en', title: 'Calculator', siteName: 'Site Co' })
  assert.doesNotMatch(html, /"><script>x<\/script>/)
  assert.match(html, /src="https:\/\/site\.test\/tools\/calc%22%3E%3Cscript%3Ex%3C%2Fscript%3E\/embed/)
  assert.match(html, /<a href="https:\/\/site\.test\/tools\/calc%22%3E%3Cscript%3Ex%3C%2Fscript%3E">/)
})

test('toolEmbedHtml links back to the canonical page, target=_top, with the resize script', () => {
  const html = toolEmbedHtml(tool, { canonical: 'https://site.test/tools/calc', siteName: 'Site Co' })
  assert.match(html, /id="seo-tool-calc"/)
  assert.match(html, /<a href="https:\/\/site\.test\/tools\/calc" target="_top">Full calculator, methodology and FAQ at Site Co<\/a>/)
  assert.match(html, /ResizeObserver/)
  assert.doesNotMatch(html, /Embed this calculator/)
})

test('verificationMetaTags renders only the tags that are set', () => {
  assert.match(verificationMetaTags({ googleMeta: 'abc' }), /name="google-site-verification" content="abc"/)
  assert.doesNotMatch(verificationMetaTags({ googleMeta: 'abc' }), /msvalidate/)
  assert.equal(verificationMetaTags(undefined), '')
  assert.match(verificationMetaTags({ bingMeta: 'xyz' }), /msvalidate\.01/)
})

test('gtagSnippet only emits for a safe measurement id', () => {
  assert.match(gtagSnippet('G-ABC123'), /gtag\('config','G-ABC123'\)/)
  assert.equal(gtagSnippet('G-ABC\'); alert(1); //'), '')
  assert.equal(gtagSnippet(undefined), '')
})

test('indexNowKeyFile matches only the exact /{key}.txt path', () => {
  const s = { ...EMPTY_SETTINGS, indexNowKey: 'abc123' }
  assert.equal(indexNowKeyFile(s, '/abc123.txt'), 'abc123')
  assert.equal(indexNowKeyFile(s, '/other.txt'), null)
  assert.equal(indexNowKeyFile(EMPTY_SETTINGS, '/abc123.txt'), null)
})

test('robots.txt renders a per-UA block for each allowed/disallowed crawler', () => {
  const snapshot: Snapshot = {
    version: 1, siteSlug: 'demo',
    settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://site' }, crawlerPolicy: { allow: ['ClaudeBot'], disallow: ['GPTBot'] } },
    pages: [], redirects: [],
  }
  const txt = robotsTxt(snapshot)
  assert.match(txt, /User-agent: ClaudeBot\nAllow: \//)
  assert.match(txt, /User-agent: GPTBot\nDisallow: \//)
})

test('robots.txt strips newlines from a crawler UA rather than letting it inject a second directive', () => {
  const snapshot: Snapshot = {
    version: 1, siteSlug: 'demo',
    settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://site' }, crawlerPolicy: { allow: ['Evil\nDisallow: /secret'], disallow: [] } },
    pages: [], redirects: [],
  }
  const txt = robotsTxt(snapshot)
  // The injected newline must not become a real line break: "Disallow: /secret" must never
  // appear as its OWN line, only (harmlessly) glued onto the mangled UA name's line.
  assert.doesNotMatch(txt, /^Disallow: \/secret$/m)
  assert.match(txt, /^User-agent: EvilDisallow: \/secret$/m)
})

test('webVitalsSnippet posts to this site\'s own /api/seo/vitals, never a hub URL or a secret', () => {
  const html = webVitalsSnippet()
  assert.match(html, /^<script>[\s\S]*<\/script>$/)
  assert.match(html, /sendBeacon\('\/api\/seo\/vitals'/)
  assert.doesNotMatch(html, /https?:\/\//, 'the beacon must never point at an absolute/hub URL directly')
})
