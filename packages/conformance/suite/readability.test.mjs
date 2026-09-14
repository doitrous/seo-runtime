import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, headingLevels, probe, snapshot, sync, wordCount } from './fixture.mjs'

// Phase 5's AI-readability bar (packages/CONTRACT.md's "v2 fields" section references this
// suite as the arbiter): the rendered home has real, extractable SSR text and a heading outline
// an AI answer engine (or a screen reader) can follow, the Arabic locale renders right-to-left
// with its own JSON-LD, and hreflang stays reciprocal across every rendered locale — not only
// the pair `resolve.test.mjs` already probes via the API.
test.before(async () => { await sync(snapshot()) })

test('the rendered home has at least 200 words of real SSR text and exactly one h1', async () => {
  const html = await (await fetch(`${BASE}/en`)).text()
  const words = wordCount(html)
  assert.ok(words >= 200, `expected >= 200 words of SSR text on /en, got ${words}`)
  const h1s = headingLevels(html).filter((l) => l === 1)
  assert.equal(h1s.length, 1, `expected exactly one <h1>, found ${h1s.length}`)
})

test('the heading order on the rendered home never skips a level', async () => {
  const html = await (await fetch(`${BASE}/en`)).text()
  const levels = headingLevels(html)
  assert.ok(levels.length >= 2, 'expected at least an h1 and a subheading to check ordering')
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] <= levels[i - 1] + 1, `heading jumped from h${levels[i - 1]} to h${levels[i]}`)
  }
})

test('the rendered home wraps its content in a <main>', async () => {
  const html = await (await fetch(`${BASE}/en`)).text()
  assert.match(html, /<main[\s>]/)
})

test('the Arabic home renders dir="rtl" and carries its own JSON-LD', async () => {
  const html = await (await fetch(`${BASE}/ar`)).text()
  assert.match(html, /dir="rtl"/)
  assert.match(html, /"@context":"https:\/\/schema\.org"/)
})

test('alternates stay reciprocal across every rendered locale, not just the /en/a,/ar/a pair', async () => {
  const en = await (await probe('/en', 'en')).json()
  const ar = await (await probe('/ar', 'ar')).json()
  assert.equal(en.alternates.ar, `${BASE}/ar`)
  assert.equal(ar.alternates.en, `${BASE}/en`)
})
