import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyApprovalAction, proxyPending, submitVitals } from './approval.ts'
import type { SeoStore } from './store.ts'

const store = { getSnapshot: async () => null } as unknown as SeoStore
const cfg = { hubUrl: 'https://hub.test', secret: 'sekret', slug: 'demo' }

test('proxyPending is 502 when the runtime is not configured', async () => {
  assert.equal((await proxyPending(store, { hubUrl: '', secret: '', slug: '' })).status, 502)
  assert.equal((await proxyPending(store, { hubUrl: 'https://hub.test', secret: '', slug: 'demo' })).status, 502)
  assert.equal((await proxyPending(store, { hubUrl: 'https://hub.test', secret: 's', slug: '' })).status, 502)
})

test('proxyPending forwards to the hub with the site secret and passes the status/body through', async () => {
  const original = global.fetch
  let seenUrl = '', seenAuth = ''
  global.fetch = (async (url: string, init?: RequestInit) => {
    seenUrl = String(url)
    seenAuth = String((init?.headers as Record<string, string>)?.Authorization)
    return new Response(JSON.stringify({ jobs: [{ id: 1 }] }), { status: 200 })
  }) as typeof fetch
  try {
    const out = await proxyPending(store, cfg)
    assert.equal(out.status, 200)
    assert.deepEqual(out.body, { jobs: [{ id: 1 }] })
    assert.equal(seenUrl, 'https://hub.test/api/sites/demo/pending')
    assert.equal(seenAuth, 'Bearer sekret')
  } finally {
    global.fetch = original
  }
})

test('proxyPending falls back to the stored snapshot slug when SEO_SITE_SLUG is unset', async () => {
  const original = global.fetch
  let seenUrl = ''
  global.fetch = (async (url: string) => { seenUrl = String(url); return new Response('{}', { status: 200 }) }) as typeof fetch
  const storeWithSlug = { getSnapshot: async () => ({ version: 1, siteSlug: 'from-snapshot', settings: {}, pages: [], redirects: [] }) } as unknown as SeoStore
  try {
    await proxyPending(storeWithSlug, { hubUrl: 'https://hub.test', secret: 's', slug: '' })
    assert.equal(seenUrl, 'https://hub.test/api/sites/from-snapshot/pending')
  } finally {
    global.fetch = original
  }
})

test('proxyPending answers 502 rather than throwing when the hub is unreachable', async () => {
  const original = global.fetch
  global.fetch = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
  try {
    const out = await proxyPending(store, cfg)
    assert.equal(out.status, 502)
  } finally {
    global.fetch = original
  }
})

test('proxyApprovalAction is 400 without a jobId or an approvedBy', async () => {
  assert.equal((await proxyApprovalAction(store, 'approve', '', { approvedBy: 'x' }, cfg)).status, 400)
  assert.equal((await proxyApprovalAction(store, 'approve', '1', { approvedBy: '' }, cfg)).status, 400)
})

test('proxyApprovalAction POSTs {approvedBy, note} to the right hub path and passes a publish_blocked error through verbatim', async () => {
  const original = global.fetch
  let seenUrl = '', seenMethod = '', seenBody: unknown = null
  global.fetch = (async (url: string, init?: RequestInit) => {
    seenUrl = String(url)
    seenMethod = String(init?.method)
    seenBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ error: 'publish_blocked', reason: 'draft_only' }), { status: 409 })
  }) as typeof fetch
  try {
    const out = await proxyApprovalAction(store, 'publish-now', '42', { approvedBy: 'Jane', note: 'looks good' }, cfg)
    assert.equal(seenUrl, 'https://hub.test/api/sites/demo/jobs/42/publish-now')
    assert.equal(seenMethod, 'POST')
    assert.deepEqual(seenBody, { approvedBy: 'Jane', note: 'looks good' })
    assert.equal(out.status, 409)
    assert.deepEqual(out.body, { error: 'publish_blocked', reason: 'draft_only' })
  } finally {
    global.fetch = original
  }
})

test('submitVitals is 502 when the runtime is not configured, and 400 without a url', async () => {
  assert.equal((await submitVitals(store, { url: 'https://x/' }, { hubUrl: '', secret: '', slug: '' })).status, 502)
  assert.equal((await submitVitals(store, { url: '' } as { url: string }, cfg)).status, 400)
})

test('submitVitals POSTs siteSlug, source:rum and the sample to /api/runtime/vitals with the site secret', async () => {
  const original = global.fetch
  let seenUrl = '', seenAuth = '', seenBody: unknown = null
  global.fetch = (async (url: string, init?: RequestInit) => {
    seenUrl = String(url)
    seenAuth = String((init?.headers as Record<string, string>)?.Authorization)
    seenBody = JSON.parse(String(init?.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  try {
    const out = await submitVitals(store, { url: 'https://site.example/en', lcp: 1200, inp: 80, cls: 0.02 }, cfg)
    assert.equal(seenUrl, 'https://hub.test/api/runtime/vitals')
    assert.equal(seenAuth, 'Bearer sekret')
    assert.deepEqual(seenBody, { siteSlug: 'demo', url: 'https://site.example/en', lcp: 1200, inp: 80, cls: 0.02, source: 'rum' })
    assert.equal(out.status, 204)
  } finally {
    global.fetch = original
  }
})
