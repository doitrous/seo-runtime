import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeHtml, intro, jsonLdScript, renderBody } from './markdown.ts'

test('raw HTML is escaped, never emitted', () => {
  const html = renderBody('<script>alert(1)</script>\n\nHello.')
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('a nested or broken tag cannot smuggle markup through', () => {
  assert.doesNotMatch(renderBody('<scr<script>ipt>x</script>'), /<script/i)
  assert.doesNotMatch(renderBody('<img src=x onerror=alert(1)>'), /<img src=x/)
})

test('links are only rendered for http(s), site-relative and anchor targets', () => {
  assert.match(renderBody('[a](https://x.com)'), /<a href="https:\/\/x\.com"/)
  assert.match(renderBody('[a](/en/b)'), /<a href="\/en\/b"/)
  assert.match(renderBody('[a](#top)'), /<a href="#top"/)
  const js = renderBody('[a](javascript:alert(1))')
  assert.doesNotMatch(js, /<a /)
  assert.match(js, />?a</)
})

test('an angle-bracket destination cannot bypass the guard', () => {
  assert.doesNotMatch(renderBody('[a](<javascript:alert(1)>)'), /<a /)
})

test('images follow the same rule and unsafe ones vanish', () => {
  assert.match(renderBody('![alt](https://x.com/a.png)'), /<img src="https:\/\/x\.com\/a\.png" alt="alt">/)
  assert.doesNotMatch(renderBody('![alt](javascript:x)'), /<img/)
})

test('external links get rel=noopener and target=_blank', () => {
  assert.match(renderBody('[a](https://x.com)'), /rel="noopener" target="_blank"/)
  assert.doesNotMatch(renderBody('[a](/en/b)'), /target="_blank"/)
})

test('only a leading H1 is dropped', () => {
  assert.doesNotMatch(renderBody('# Title\n\nBody.'), /<h1>/)
  assert.match(renderBody('Body.\n\n# Later'), /<h1>/)
})

test('intro takes the first prose paragraph with markup stripped', () => {
  assert.equal(intro('# Title\n\n[Anna](/a) is a *dermatologist*.\n\nMore.'), 'Anna is a dermatologist.')
  assert.equal(intro('# Only a title'), '')
})

test('escapeHtml covers the five dangerous characters', () => {
  assert.equal(escapeHtml(`<a href="x" & 'y'>`), '&lt;a href=&quot;x&quot; &amp; &apos;y&apos;&gt;')
})

test('the JSON-LD script escapes the tag opener', () => {
  const s = jsonLdScript([{ '@type': 'Thing', name: '</script><img>' }])
  assert.doesNotMatch(s.replace('</script>', ''), /<\/script>/)
  assert.match(s, /\\u003c/)
})
