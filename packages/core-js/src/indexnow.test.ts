import assert from 'node:assert/strict'
import test from 'node:test'
import { submitIndexNow } from './indexnow.ts'
import { EMPTY_SETTINGS } from './types.ts'

const withKey = { ...EMPTY_SETTINGS, indexNowKey: 'abc123' }

test('submitIndexNow is 502 when no indexNowKey is configured', async () => {
  const out = await submitIndexNow(EMPTY_SETTINGS, ['https://site.example/en'])
  assert.equal(out.status, 502)
})

test('submitIndexNow is 400 for a missing, empty or non-array urlList', async () => {
  assert.equal((await submitIndexNow(withKey, undefined)).status, 400)
  assert.equal((await submitIndexNow(withKey, [])).status, 400)
  assert.equal((await submitIndexNow(withKey, 'https://site.example/en')).status, 400)
})

test('submitIndexNow is 400 when the first entry is not a URL at all', async () => {
  const out = await submitIndexNow(withKey, ['not a url'])
  assert.equal(out.status, 400)
})

test('submitIndexNow POSTs host/key/keyLocation/urlList to IndexNow, dropping URLs for another host', async () => {
  const original = global.fetch
  let seenUrl = '', seenBody: unknown = null
  global.fetch = (async (url: string, init?: RequestInit) => {
    seenUrl = String(url)
    seenBody = JSON.parse(String(init?.body))
    return new Response('', { status: 200 })
  }) as typeof fetch
  try {
    const out = await submitIndexNow(withKey, [
      'https://site.example/en', 'https://site.example/en/a', 'https://other.example/en',
    ])
    assert.equal(seenUrl, 'https://api.indexnow.org/indexnow')
    assert.deepEqual(seenBody, {
      host: 'site.example', key: 'abc123', keyLocation: 'https://site.example/abc123.txt',
      urlList: ['https://site.example/en', 'https://site.example/en/a'],
    })
    assert.equal(out.status, 200)
  } finally {
    global.fetch = original
  }
})

test('submitIndexNow answers 502 rather than throwing when IndexNow is unreachable', async () => {
  const original = global.fetch
  global.fetch = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
  try {
    const out = await submitIndexNow(withKey, ['https://site.example/en'])
    assert.equal(out.status, 502)
  } finally {
    global.fetch = original
  }
})
