import assert from 'node:assert/strict'
import test from 'node:test'
import { headTags, injectHead } from './inject.ts'
import type { ResolvedSeo } from '@omary98/seo-runtime-core'

const seo: ResolvedSeo = {
  title: 'A & B', description: 'Say "hi".', canonical: 'https://x.com/en/a',
  robots: { index: true, follow: true },
  alternates: { en: 'https://x.com/en/a', ar: 'https://x.com/ar/a', 'x-default': 'https://x.com/en/a' },
  og: { title: 'OG', description: 'OGD', image: 'https://x.com/og.png' },
  twitter: { title: 'TW', description: 'TWD', image: 'https://x.com/og.png' },
  jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: '</script>' }],
}

test('every string is escaped in the head tags', () => {
  const head = headTags(seo)
  assert.match(head, /<title>A &amp; B<\/title>/)
  assert.match(head, /content="Say &quot;hi&quot;\."/)
  assert.doesNotMatch(head, /Say "hi"/)
})

test('canonical, alternates and robots are emitted', () => {
  const head = headTags(seo)
  assert.match(head, /<link rel="canonical" href="https:\/\/x\.com\/en\/a">/)
  assert.match(head, /hreflang="ar" href="https:\/\/x\.com\/ar\/a"/)
  assert.match(head, /hreflang="x-default"/)
  assert.match(head, /<meta name="robots" content="index, follow">/)
})

test('noindex and nofollow are spelled out', () => {
  const head = headTags({ ...seo, robots: { index: false, follow: false } })
  assert.match(head, /content="noindex, nofollow"/)
})

test('JSON-LD escapes the tag opener', () => {
  const head = headTags(seo)
  assert.match(head, /\\u003c\/script/)
})

test('injectHead puts the tags just before </head>', () => {
  const out = injectHead('<html><head><meta charset="utf-8"></head><body>x</body></html>', seo)
  assert.match(out, /<meta charset="utf-8"><title>/)
  assert.match(out, /<\/head><body>x/)
})

test('a document with no head is returned untouched', () => {
  assert.equal(injectHead('<p>x</p>', seo), '<p>x</p>')
})

test('a title containing $& is inserted literally, not read as a regex backreference', () => {
  const out = injectHead('<html><head><meta charset="utf-8"></head><body>x</body></html>', { ...seo, title: 'A $& B' })
  assert.match(out, /<title>A \$&amp; B<\/title>/)
  assert.match(out, /<\/head><body>x/)
})

test('an existing title in the shell is replaced, not duplicated', () => {
  const out = injectHead('<html><head><title>Old</title></head><body></body></html>', seo)
  assert.doesNotMatch(out, /<title>Old<\/title>/)
  assert.equal(out.match(/<title>/g)!.length, 1)
})

test('canonical, description, hreflang, OG and Twitter tags baked into the shell are replaced, not doubled', () => {
  const shell = '<html><head><meta charset="utf-8"><title>old</title>'
    + '<link rel="canonical" href="https://old.test/x"><LINK href="https://old.test/ar" hreflang="ar" rel="alternate">'
    + "<meta name='description' content='old'><meta name=\"robots\" content=\"noindex\">"
    + '<meta property="og:title" content="old"><meta content="old" name="twitter:title">'
    + '<meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/a.css">'
    + '<script type="application/ld+json">{"@type":"Organization"}</script></head><body></body></html>'
  const out = injectHead(shell, seo)
  const count = (re: RegExp) => (out.match(re) ?? []).length
  assert.equal(count(/<title>/g), 1)
  assert.equal(count(/rel="canonical"/g), 1)
  assert.equal(count(/hreflang=/g), Object.keys(seo.alternates).length)
  assert.equal(count(/name="description"/g), 1)
  assert.equal(count(/name="robots"/g), 1)
  assert.equal(count(/property="og:title"/g), 1)
  assert.equal(count(/name="twitter:title"/g), 1)
  assert.doesNotMatch(out, /old\.test/)
  assert.match(out, /name="viewport"/)
  assert.match(out, /rel="stylesheet"/)
  assert.match(out, /"@type":"Organization"/)
})
