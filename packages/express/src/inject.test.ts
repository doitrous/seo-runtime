import assert from 'node:assert/strict'
import test from 'node:test'
import { headTags, injectHead } from './inject.ts'
import type { ResolvedSeo } from '@doitrous/seo-runtime-core'

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

test('an existing title in the shell is replaced, not duplicated', () => {
  const out = injectHead('<html><head><title>Old</title></head><body></body></html>', seo)
  assert.doesNotMatch(out, /<title>Old<\/title>/)
  assert.equal(out.match(/<title>/g)!.length, 1)
})
