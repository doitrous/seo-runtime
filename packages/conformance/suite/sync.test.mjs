import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, nextVersion, snapshot, sync } from './fixture.mjs'

test('a snapshot is applied and echoed with its version', async () => {
  const v = nextVersion()
  const res = await sync(snapshot({ version: v }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, 'applied')
  assert.equal(body.version, v)
})

test('an older snapshot is answered stale and echoes the stored version', async () => {
  const v = nextVersion()
  await sync(snapshot({ version: v }))
  const res = await sync(snapshot({ version: v - 1 }))
  const body = await res.json()
  assert.equal(body.status, 'stale')
  // packages/CONTRACT.md: a stale sync is answered with the STORED (higher) version, never the
  // rejected incoming one.
  assert.equal(body.version, v)
})

test('a malformed body is a clean 400, never a 500', async () => {
  const res = await fetch(`${BASE}/api/seo/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CONFORMANCE_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ not: 'a snapshot' }),
  })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).status, 'invalid')
})

test('sync without the secret is 401', async () => {
  const res = await fetch(`${BASE}/api/seo/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
})
