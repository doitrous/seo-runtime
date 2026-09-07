import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, snapshot, sync } from './fixture.mjs'

test('robots lists the extra lines and the sitemap', async () => {
  await sync(snapshot())
  const txt = await (await fetch(`${BASE}/robots.txt`)).text()
  assert.match(txt, /^User-agent: \*/m)
  assert.match(txt, /^Disallow: \/tmp$/m)
  assert.match(txt, new RegExp(`^Sitemap: ${BASE}/sitemap.xml$`, 'm'))
})

test('the kill switch disallows everything and lists no sitemap', async () => {
  const off = snapshot()
  off.settings.indexingEnabled = false
  await sync(off)
  const txt = await (await fetch(`${BASE}/robots.txt`)).text()
  assert.match(txt, /^Disallow: \/$/m)
  assert.doesNotMatch(txt, /Sitemap:/)
  await sync(snapshot())   // restore indexing — later files in the suite expect it enabled
})
