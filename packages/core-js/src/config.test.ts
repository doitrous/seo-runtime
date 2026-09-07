import assert from 'node:assert/strict'
import test from 'node:test'
import { bearerOf, readConfig, timingSafeSecret } from './config.ts'

test('config reads exactly the three env vars', () => {
  const c = readConfig({ SEO_HUB_URL: 'https://hub/', SEO_HUB_SECRET: 's', SEO_SITE_SLUG: 'x' } as NodeJS.ProcessEnv)
  assert.deepEqual(c, { hubUrl: 'https://hub', secret: 's', slug: 'x' })
})

test('the slug is optional and defaults to an empty string', () => {
  // Optional to READ. Not optional to run: the pull URL and the health body both carry the slug,
  // so until a snapshot is stored the runtime has to fall back to SEO_SITE_SLUG. B7's `pullSnapshot`
  // and `sendHealth` take the slug as `config.slug || storedSlug`, in that order.
  const c = readConfig({ SEO_HUB_URL: 'https://hub', SEO_HUB_SECRET: 's' } as NodeJS.ProcessEnv)
  assert.equal(c.slug, '')
})

test('a missing hub URL or secret yields empty strings rather than throwing', () => {
  const c = readConfig({} as NodeJS.ProcessEnv)
  assert.deepEqual(c, { hubUrl: '', secret: '', slug: '' })
})

test('the bearer token is extracted case-insensitively', () => {
  assert.equal(bearerOf('Bearer abc'), 'abc')
  assert.equal(bearerOf('bearer abc'), 'abc')
  assert.equal(bearerOf('Basic abc'), '')
  assert.equal(bearerOf(null), '')
})

test('secret comparison is exact and refuses empty secrets', () => {
  assert.equal(timingSafeSecret('abc', 'abc'), true)
  assert.equal(timingSafeSecret('abd', 'abc'), false)
  assert.equal(timingSafeSecret('abcd', 'abc'), false)
  assert.equal(timingSafeSecret('', ''), false)
  assert.equal(timingSafeSecret('abc', ''), false)
})
