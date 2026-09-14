import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import http from 'node:http'
import express from 'express'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonFileStore, EMPTY_SETTINGS, type Snapshot } from '@omary98/seo-runtime-core'
import { seoRuntime, type ExpressSeoOptions } from './index.ts'

process.env.SEO_HUB_SECRET = 's3cret'
process.env.SEO_SITE_SLUG = 'demo'
// Deliberately NOT set here: every existing test in this file boots with SEO_HUB_URL unset, which
// is what makes startSync's boot-time pullSnapshot/sendHealth no-op instead of reaching out to a
// real network. The two v2 proxy tests below set it only for the moment they need it.

const snapshot: Snapshot = {
  version: 1, siteSlug: 'demo',
  settings: { ...EMPTY_SETTINGS, baseUrls: { en: 'https://demo.test' }, brandSuffix: ' | Demo', robotsExtra: ['Disallow: /tmp'] },
  pages: [{
    key: 'p:1', type: 'page', lang: 'en', path: '/en/a', group: 'p:1', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z',
    seo: { seoTitle: 'A page', metaDescription: 'About A.', canonical: '', index: true, follow: true, includeInSitemap: true, priority: 0.5, og: { title: '', description: '', image: '' }, twitter: { title: '', description: '', image: '' }, schemaType: '', structuredData: [], faq: [] },
  }],
  redirects: [{ source: '/old', destination: '/en/a', type: 301, active: true }],
}

/** Boots a real HTTP server around the registrar and registers its teardown on `t`, so a failed
 * assertion still closes the socket instead of leaking a listener that keeps the process alive. */
function boot(t: TestContext, over: Partial<ExpressSeoOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'express-pkg-'))
  const store = new JsonFileStore(join(dir, 'state.json'))
  const app = express()
  seoRuntime({
    store,
    pages: async () => [{ key: 'p:1', type: 'page', lang: 'en', path: '/en/a', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z' }],
    supported: ['en', 'ar'], version: '0.1.0', ...over,
  } as ExpressSeoOptions)(app)
  app.get('/en/a', async (_req, res) =>
    res.type('html').send(await res.locals.injectHead('<html><head><title>x</title></head><body>hi</body></html>')))
  const server = http.createServer(app)
  t.after(() => new Promise<void>((r) => { server.close(() => r()); rmSync(dir, { recursive: true, force: true }) }))
  return new Promise<{ url: string; store: JsonFileStore }>((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${port}`, store })
    })
  })
}

const authed = { authorization: 'Bearer s3cret' }

test('sync applies a snapshot and answers with the version', async (t) => {
  const { url } = await boot(t)
  const res = await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'applied', version: 1 })
})

test('every route but the sitemap and robots needs the bearer secret', async (t) => {
  const { url } = await boot(t)
  for (const [method, path] of [['GET', '/api/seo/pages'], ['GET', '/api/seo/health'], ['GET', '/api/seo/probe'], ['POST', '/api/seo/sync'], ['POST', '/api/articles'], ['GET', '/api/seo/bogus']] as const) {
    const res = await fetch(`${url}${path}`, { method })
    assert.equal(res.status, 401, `${method} ${path}`)
  }
  const sitemap = await fetch(`${url}/sitemap.xml`)
  const robots = await fetch(`${url}/robots.txt`)
  assert.equal(sitemap.status, 200)
  assert.equal(robots.status, 200)
  const bogus = await fetch(`${url}/api/seo/bogus`, { headers: authed })
  assert.equal(bogus.status, 404)
  assert.deepEqual(await bogus.json(), { error: 'not found' })
})

test('a malformed JSON body is a 400, never a 500', async (t) => {
  const { url } = await boot(t)
  const res = await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: '{not json' })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { status: 'invalid', version: 0 })
})

test('a declared body over 2 MB is refused before any of it is read', async (t) => {
  const { url } = await boot(t)
  const { hostname, port } = new URL(`${url}/api/seo/sync`)
  const status = await new Promise<number>((resolve, reject) => {
    // A raw request carrying only the declared header, no body: the server must answer 413 off
    // the header alone, so nothing more ever needs to be written for this to resolve.
    const req = http.request({
      hostname, port, path: '/api/seo/sync', method: 'POST',
      headers: { ...authed, 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024), connection: 'close' },
    })
    // Resolve as soon as the status line arrives and drop the socket — this client has no more
    // than the declared header to send anyway, so there is nothing to wait on afterwards.
    req.on('response', (res) => { resolve(res.statusCode ?? 0); res.destroy() })
    req.on('error', reject)
    req.end()
  })
  assert.equal(status, 413)
})

test('a chunked body (no content-length) over 2 MB is refused on the stream', async (t) => {
  const { url } = await boot(t)
  const { hostname, port } = new URL(`${url}/api/seo/sync`)
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request({
      hostname, port, path: '/api/seo/sync', method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
    })
    assert.equal(req.getHeader('content-length'), undefined)
    req.on('response', (res) => { resolve(res.statusCode ?? 0); res.destroy(); req.destroy() })
    req.on('error', (err: NodeJS.ErrnoException) => {
      // The server answers 413 and the connection tears down as soon as the byte count passes
      // the cap; a write against that closing socket can legitimately race a reset. Only a
      // response already resolved this promise, so a late reset here is a no-op.
      if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') reject(err)
    })
    const chunk = Buffer.alloc(512 * 1024, 'x')
    let i = 0
    const pump = () => {
      while (i < 6) {
        i++
        if (!req.write(chunk)) { req.once('drain', pump); return }
      }
      req.end()
    }
    pump()
  })
  assert.equal(status, 413)
})

test('the page provider output includes article pages via the default articlePath', async (t) => {
  const { url } = await boot(t)
  const ingest = await fetch(`${url}/api/articles`, {
    method: 'POST', headers: { ...authed, 'content-type': 'application/json' },
    body: JSON.stringify({ externalId: 9, articles: [{ lang: 'en', title: 'T', slug: 'hair', bodyMd: '# T\n\nBody.' }] }),
  })
  assert.equal(ingest.status, 200)
  const pages = await (await fetch(`${url}/api/seo/pages`, { headers: authed })).json() as { pages: { path: string; type: string }[] }
  assert.ok(pages.pages.some((p) => p.path === '/en/a' && p.type === 'page'))
  assert.ok(pages.pages.some((p) => p.path === '/en/blog/hair' && p.type === 'article'))
})

test('a site-specific articlePath moves the article URL everywhere', async (t) => {
  const { url } = await boot(t, { articlePath: (lang, slug) => `/${lang}/articles/${slug}` })
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  const ingest = await fetch(`${url}/api/articles`, {
    method: 'POST', headers: { ...authed, 'content-type': 'application/json' },
    body: JSON.stringify({ externalId: 9, articles: [{ lang: 'en', title: 'T', slug: 'hair', bodyMd: '# T\n\nBody.' }] }),
  })
  const body = await ingest.json() as { results: { remoteUrl: string }[] }
  assert.equal(body.results[0].remoteUrl, 'https://demo.test/en/articles/hair')
})

test('remoteUrl uses each language\'s own base URL, not just the first one', async (t) => {
  const { url } = await boot(t)
  const twoOrigins = { ...snapshot, settings: { ...snapshot.settings, baseUrls: { en: 'https://demo.test', ar: 'https://ar.demo.test' } } }
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(twoOrigins) })
  const ingest = await fetch(`${url}/api/articles`, {
    method: 'POST', headers: { ...authed, 'content-type': 'application/json' },
    body: JSON.stringify({ externalId: 9, articles: [
      { lang: 'en', title: 'T', slug: 'hair', bodyMd: 'x' },
      { lang: 'ar', title: 'T', slug: 'hair-ar', bodyMd: 'x' },
    ] }),
  })
  const body = await ingest.json() as { results: { lang: string; remoteUrl: string }[] }
  assert.equal(body.results.find((r) => r.lang === 'en')!.remoteUrl, 'https://demo.test/en/blog/hair')
  assert.equal(body.results.find((r) => r.lang === 'ar')!.remoteUrl, 'https://ar.demo.test/ar/blog/hair-ar')
})

test('health is authenticated, reports counts and does not drain', async (t) => {
  const { url, store } = await boot(t)
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  await store.incrementHit('/old')
  const res = await fetch(`${url}/api/seo/health`, { headers: authed })
  const body = await res.json() as { version: string; counts: { pages: number }; redirectHits: unknown[] }
  assert.equal(res.status, 200)
  assert.equal(body.version, '0.1.0')
  assert.equal(body.counts.pages, 1)
  assert.deepEqual(body.redirectHits, [{ source: '/old', hits: 1 }])
  const again = await (await fetch(`${url}/api/seo/health`, { headers: authed })).json() as { redirectHits: unknown[] }
  assert.deepEqual(again.redirectHits, [{ source: '/old', hits: 1 }])
})

test('the probe returns resolveSeo', async (t) => {
  const { url } = await boot(t)
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  const body = await (await fetch(`${url}/api/seo/probe?path=/en/a&lang=en`, { headers: authed })).json() as { title: string; canonical: string }
  assert.equal(body.title, 'A page | Demo')
  assert.equal(body.canonical, 'https://demo.test/en/a')
})

test('a redirect is applied before auth, ahead of every other route', async (t) => {
  const { url } = await boot(t)
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  const res = await fetch(`${url}/old`, { redirect: 'manual' })
  assert.equal(res.status, 301)
  assert.equal(res.headers.get('location'), '/en/a')
})

test('res.locals.injectHead resolves SEO lazily for the requested path', async (t) => {
  const { url } = await boot(t)
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  const html = await (await fetch(`${url}/en/a`)).text()
  assert.match(html, /<title>A page \| Demo<\/title>/)
  assert.equal(html.match(/<title>/g)!.length, 1)
})

test('the sitemap is empty with no snapshot and lists pages once one is applied', async (t) => {
  const { url } = await boot(t)
  const empty = await (await fetch(`${url}/sitemap.xml`)).text()
  assert.doesNotMatch(empty, /<url>/)
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(snapshot) })
  const filled = await (await fetch(`${url}/sitemap.xml`)).text()
  assert.match(filled, /https:\/\/demo\.test\/en\/a/)
})

test('v2: an author page renders a Person JSON-LD block and 404s for an unknown slug', async (t) => {
  const { url } = await boot(t)
  const withAuthor: Snapshot = { ...snapshot, settings: { ...snapshot.settings, authors: [{ slug: 'jane', name: 'Jane Doe', title: 'Editor', credentials: '', sameAs: [], bio: '' }] } }
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(withAuthor) })
  const html = await (await fetch(`${url}/authors/jane`)).text()
  assert.match(html, /<h1>Jane Doe<\/h1>/)
  assert.match(html, /"@type":"Person"/)
  assert.equal((await fetch(`${url}/authors/nope`)).status, 404)
})

test('v2: a help page puts the question in an h1 with an Article JSON-LD carrying dateModified', async (t) => {
  const { url } = await boot(t)
  const withHelp: Snapshot = { ...snapshot, settings: { ...snapshot.settings, helpEntries: [{ slug: 'refund', lang: 'en', question: 'How do refunds work?', answerHtml: '<p>Answer.</p>', moneyPageUrl: '/pricing', updatedAt: '2026-09-01T00:00:00.000Z' }] } }
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(withHelp) })
  const html = await (await fetch(`${url}/help/refund`)).text()
  assert.match(html, /<h1>How do refunds work\?<\/h1>/)
  assert.match(html, /"@type":"Article"/)
  assert.match(html, /"dateModified":"2026-09-01T00:00:00.000Z"/)
})

test('v2: a tool page renders the placeholder container with a WebApplication JSON-LD', async (t) => {
  const { url } = await boot(t)
  const withTool: Snapshot = { ...snapshot, settings: { ...snapshot.settings, tools: [{ slug: 'calc', lang: 'en', kind: 'Calculator', config: {}, methodologyHtml: '<p>Method.</p>', dataSource: 'ONS', asOf: '2026-08-01' }] } }
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(withTool) })
  const html = await (await fetch(`${url}/tools/calc`)).text()
  assert.match(html, /id="seo-tool-calc"/)
  assert.match(html, /"@type":"WebApplication"/)
})

// The mocked fetch below must discriminate by URL: the outer test request to the local test
// server (127.0.0.1) has to reach the REAL fetch, and only the proxy's own internal call to
// SEO_HUB_URL ('https://hub.test') is the one this suite wants to intercept.
function mockHubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = global.fetch
  global.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u)
    return url.startsWith('https://hub.test') ? handler(url, init) : original(u as never, init)
  }) as typeof fetch
  return original
}

test('v2: the pending proxy forwards the site secret and passes the hub status/body through', async (t) => {
  const { url } = await boot(t)   // boots with SEO_HUB_URL still unset — startSync's own pull/health stay no-ops
  let seenAuth = ''
  const original = mockHubFetch((_u, init) => {
    seenAuth = String((init?.headers as Record<string, string>)?.Authorization)
    return new Response(JSON.stringify({ jobs: [{ id: 7 }] }), { status: 200 })
  })
  process.env.SEO_HUB_URL = 'https://hub.test'
  try {
    const res = await fetch(`${url}/api/seo/pending`, { headers: authed })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { jobs: [{ id: 7 }] })
    assert.equal(seenAuth, 'Bearer s3cret')
  } finally {
    global.fetch = original
    delete process.env.SEO_HUB_URL
  }
})

test('v2: the pending proxy needs the site secret', async (t) => {
  const { url } = await boot(t)
  assert.equal((await fetch(`${url}/api/seo/pending`)).status, 401)
})

test('v2: approve posts {approvedBy, note} to the hub and relays a publish_blocked error', async (t) => {
  const { url } = await boot(t)
  let seenUrl = '', seenBody: unknown = null
  const original = mockHubFetch((u, init) => {
    seenUrl = u
    seenBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ error: 'publish_blocked', reason: 'draft_only' }), { status: 409 })
  })
  process.env.SEO_HUB_URL = 'https://hub.test'
  try {
    const res = await fetch(`${url}/api/seo/approve`, {
      method: 'POST', headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: '9', approvedBy: 'Jane', note: 'ok' }),
    })
    assert.equal(res.status, 409)
    assert.deepEqual(await res.json(), { error: 'publish_blocked', reason: 'draft_only' })
    assert.match(seenUrl, /\/jobs\/9\/approve$/)
    assert.deepEqual(seenBody, { approvedBy: 'Jane', note: 'ok' })
  } finally {
    global.fetch = original
    delete process.env.SEO_HUB_URL
  }
})

test('v2: indexnow needs the site secret, then forwards urlList to IndexNow with the site key', async (t) => {
  const { url, store } = await boot(t)
  await store.putSnapshot({ ...snapshot, settings: { ...snapshot.settings, indexNowKey: 'the-key' } })
  assert.equal((await fetch(`${url}/api/seo/indexnow`, { method: 'POST' })).status, 401)

  const original = global.fetch
  let seenUrl = '', seenBody: unknown = null
  global.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const s = String(u)
    if (!s.startsWith('https://api.indexnow.org')) return original(u as never, init)
    seenUrl = s
    seenBody = JSON.parse(String(init?.body))
    return new Response('', { status: 200 })
  }) as typeof fetch
  try {
    const res = await fetch(`${url}/api/seo/indexnow`, {
      method: 'POST', headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ urlList: ['https://demo.test/en/a'] }),
    })
    assert.equal(res.status, 200)
    assert.equal(seenUrl, 'https://api.indexnow.org/indexnow')
    assert.deepEqual(seenBody, { host: 'demo.test', key: 'the-key', keyLocation: 'https://demo.test/the-key.txt', urlList: ['https://demo.test/en/a'] })
  } finally {
    global.fetch = original
  }
})

test('v2: the vitals beacon needs no secret and relays the sample to the hub with one', async (t) => {
  const { url } = await boot(t)
  let seenAuth = '', seenBody: unknown = null
  const original = mockHubFetch((_u, init) => {
    seenAuth = String((init?.headers as Record<string, string>)?.Authorization)
    seenBody = JSON.parse(String(init?.body))
    return new Response(null, { status: 204 })
  })
  process.env.SEO_HUB_URL = 'https://hub.test'
  try {
    const res = await fetch(`${url}/api/seo/vitals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },   // no Authorization at all
      body: JSON.stringify({ url: 'https://demo.test/en/a', lcp: 1200, inp: 50, cls: 0.01 }),
    })
    assert.equal(res.status, 204)
    assert.equal(seenAuth, 'Bearer s3cret')
    assert.deepEqual(seenBody, { siteSlug: 'demo', url: 'https://demo.test/en/a', lcp: 1200, inp: 50, cls: 0.01, source: 'rum' })
  } finally {
    global.fetch = original
    delete process.env.SEO_HUB_URL
  }
})

test('v2: the admin panel is secret-protected via ?secret= or the Authorization header', async (t) => {
  const { url } = await boot(t)
  assert.equal((await fetch(`${url}/seo-admin`)).status, 401)
  assert.equal((await fetch(`${url}/seo-admin?secret=s3cret`)).status, 200)
  assert.equal((await fetch(`${url}/seo-admin`, { headers: authed })).status, 200)
})

test('v2: the IndexNow key file is served at /{key}.txt with the key as the body', async (t) => {
  const { url } = await boot(t)
  const withKey: Snapshot = { ...snapshot, settings: { ...snapshot.settings, indexNowKey: 'abc123def' } }
  await fetch(`${url}/api/seo/sync`, { method: 'POST', headers: { ...authed, 'content-type': 'application/json' }, body: JSON.stringify(withKey) })
  const res = await fetch(`${url}/abc123def.txt`)
  assert.equal(res.status, 200)
  assert.equal((await res.text()).trim(), 'abc123def')
  assert.equal((await fetch(`${url}/other.txt`)).status, 404)
})
