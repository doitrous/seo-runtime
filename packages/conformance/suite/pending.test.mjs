import assert from 'node:assert/strict'
import test from 'node:test'
import { auth, BASE } from './fixture.mjs'

/**
 * The pending/approve proxy (packages/CONTRACT.md's "Pending/approve proxy" section): this
 * site's own secret in, the hub's runtime secret out, the hub's status and body passed through
 * verbatim. Exercising the real proxy needs a real hub answering on the other end, so — unlike
 * every other file in this suite, which only needs the demo's own secret — this one additionally
 * needs the demo started with SEO_HUB_URL pointing at ../mock-hub.mjs (see that file's own
 * docblock, and .github/workflows/test.yml for how the two are wired together in CI).
 */
test('the pending proxy forwards to the hub and returns its mocked job list verbatim', async () => {
  const res = await fetch(`${BASE}/api/seo/pending`, { headers: auth })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(Array.isArray(body.jobs) && body.jobs.length > 0, "expected the mock hub's job list to pass through")
  const job = body.jobs[0]
  for (const k of ['id', 'title', 'lang', 'publishAt', 'previewUrl']) assert.ok(k in job, `pending job is missing ${k}`)
})

test('approve posts approvedBy to the hub and relays its response verbatim', async () => {
  const res = await fetch(`${BASE}/api/seo/approve`, {
    method: 'POST', headers: auth, body: JSON.stringify({ jobId: 'job-1', approvedBy: 'Conformance' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.jobId, 'job-1')
  assert.equal(body.action, 'approve')
})

test('approve without an approvedBy is rejected before it ever reaches the hub', async () => {
  const res = await fetch(`${BASE}/api/seo/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ jobId: 'job-1' }) })
  assert.equal(res.status, 400)
})

test('pending is refused without the site secret', async () => {
  const res = await fetch(`${BASE}/api/seo/pending`)
  assert.equal(res.status, 401)
})
