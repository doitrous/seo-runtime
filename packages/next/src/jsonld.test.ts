import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import { SeoJsonLd } from './jsonld.ts'

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
