import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, snapshot, sync } from './fixture.mjs'

test('robots lists the extra lines and the sitemap', async () => {
  await sync(snapshot())
  const txt = await (await fetch(`${BASE}/robots.txt`)).text()
  assert.match(txt, /^User-agent: \*/m)
  assert.match(txt, /^Allow: \/$/m)
  assert.match(txt, /^Disallow: \/tmp$/m)
  assert.match(txt, new RegExp(`^Sitemap: ${BASE}/sitemap.xml$`, 'm'))
})

test('the kill switch disallows everything and lists no sitemap', async () => {
  const off = snapshot()
  off.settings.indexingEnabled = false
  await sync(off)
  const txt = await (await fetch(`${BASE}/robots.txt`)).text()
  // Exact body per packages/CONTRACT.md's Robots section — not just a substring match: the kill
  // switch body is nothing but these two lines, no Allow, no robotsExtra, no Sitemap line.
  assert.match(txt, /^User-agent: \*\nDisallow: \/\n?$/)
  await sync(snapshot())   // restore indexing — later files in the suite expect it enabled
})
