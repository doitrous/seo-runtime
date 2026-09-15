import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import { SeoJsonLd, ShareBlock, SeoWebVitals } from './jsonld.ts'

test('SeoJsonLd renders one escaped ld+json script per entry and no wrapper element', () => {
  const el = SeoJsonLd({ seo: { jsonld: [{ '@type': 'Thing', name: '</script><b>' }, { '@type': 'X' }] } as never })
  const kids = (el.props as { children: ReactElement[] }).children
  assert.equal(kids.length, 2)
  assert.equal(kids[0].type, 'script')
  const props = kids[0].props as { type: string; dangerouslySetInnerHTML: { __html: string } }
  assert.equal(props.type, 'application/ld+json')
  assert.doesNotMatch(props.dangerouslySetInnerHTML.__html, /<\/script>/)
  assert.match(props.dangerouslySetInnerHTML.__html, /\\u003c\/script>/)
})

test("SeoWebVitals posts to this site's own /api/seo/vitals, never a hub URL or a secret", () => {
  const el = SeoWebVitals()
  const html = (el.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML.__html
  assert.match(html, /sendBeacon\('\/api\/seo\/vitals'/)
  assert.doesNotMatch(html, /https?:\/\//)
})

test('ShareBlock server-renders share links from the canonical URL and title', () => {
  const el = ShareBlock({ url: 'https://demo.test/en/a', title: 'A <b>page</b>' })
  const html = (el.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML.__html
  assert.match(html, /class="seo-share"/)
  assert.match(html, /https:\/\/wa\.me\/\?text=/)
  assert.doesNotMatch(html, /<b>page<\/b>/)
  assert.match(html, /navigator\.share/)
})
