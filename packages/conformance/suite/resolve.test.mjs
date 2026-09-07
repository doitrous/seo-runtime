import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, probe, snapshot, sync } from './fixture.mjs'

test.before(async () => { await sync(snapshot()) })

test('a known page resolves with the brand suffix and a self canonical', async () => {
  const seo = await (await probe('/en/a', 'en')).json()
  assert.equal(seo.title, 'A page | Demo')
  assert.equal(seo.description, 'About A.')
  assert.equal(seo.canonical, `${BASE}/en/a`)
  assert.deepEqual(seo.robots, { index: true, follow: true })
})

test('probing without the secret is 401', async () => {
  const res = await fetch(`${BASE}/api/seo/probe?path=/en/a&lang=en`)
  assert.equal(res.status, 401)
})

test('alternates are reciprocal and carry x-default', async () => {
  const seo = await (await probe('/en/a', 'en')).json()
  assert.equal(seo.alternates.en, `${BASE}/en/a`)
  assert.equal(seo.alternates.ar, `${BASE}/ar/a`)
  assert.equal(seo.alternates['x-default'], `${BASE}/en/a`)
})

test('the site default OG image is used when the page has none', async () => {
  const seo = await (await probe('/en/a', 'en')).json()
  assert.equal(seo.og.image, `${BASE}/og.png`)
})

test('the organization is the trailing JSON-LD entry', async () => {
  const seo = await (await probe('/en/a', 'en')).json()
  assert.equal(seo.jsonld.at(-1)['@type'], 'Organization')
  assert.equal(seo.jsonld.at(-1).name, 'Demo Co')
})

test('an unknown path resolves to defaults rather than failing', async () => {
  const res = await probe('/en/nothing-here', 'en')
  assert.equal(res.status, 200)
  const seo = await res.json()
  assert.equal(seo.canonical, `${BASE}/en/nothing-here`)
})

test('the kill switch forces noindex within one sync', async () => {
  const off = snapshot()
  off.settings.indexingEnabled = false
  await sync(off)
  const seo = await (await probe('/en/a', 'en')).json()
  assert.equal(seo.robots.index, false)
  await sync(snapshot())   // restore indexing for the rest of the suite
})

// Controller ruling: assert this on the raw HTML of an actual demo page, not on the probe API —
// the probe only proves resolveSeo escapes correctly, not that a renderer serializes it safely.
// Both demos serve a real page at /en (Express's own route, Next's [lang] route), so syncing a
// page record at that exact path makes resolveSeo(store, '/en', 'en') return our payload when the
// site renders it for real.
test('a JSON-LD entry containing </script> is escaped on the actual rendered page', async () => {
  const evil = snapshot()
  evil.pages[0].path = '/en'
  evil.pages[0].lang = 'en'
  evil.pages[0].seo.structuredData = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: '</script><script>alert(1)</script>' },
  ]
  await sync(evil)
  const html = await (await fetch(`${BASE}/en`)).text()
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'the raw payload must never appear as an executable script tag')
  assert.match(html, /\\u003c\/script>/, 'the "<" in the JSON-LD string must be escaped as the six-character \\u003c sequence')
  await sync(snapshot())   // restore the plain fixture pages for the rest of the suite
})
