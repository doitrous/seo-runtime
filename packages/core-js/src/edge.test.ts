import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = dirname(fileURLToPath(import.meta.url))
const read = (f: string) => readFileSync(join(src, f), 'utf8')

/** Every local module a file's `from './x.ts'` imports pull in, one level. */
function localImports(file: string): string[] {
  return [...read(file).matchAll(/from '\.\/([\w-]+)\.ts'/g)].map((m) => `${m[1]}.ts`)
}

/**
 * A Next proxy runs in a bundle that has no Node built-ins. `@doitrous/seo-runtime-core/edge` is
 * what it imports, so every module reachable from that barrel — transitively, not just the ones
 * it re-exports directly — has to be free of them.
 */
test('the edge barrel pulls in no Node built-in, transitively', () => {
  const seen = new Set<string>()
  const queue = ['edge.ts']
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const contents = read(file)
    assert.doesNotMatch(contents, /from 'node:/, `${file} imports a Node built-in`)
    assert.doesNotMatch(contents, /from '\.\/config\.ts'|from '\.\/stores\//, `${file} reaches a Node-only module`)
    queue.push(...localImports(file))
  }
  assert.ok(seen.size >= 5, 'edge.ts should transitively reach types, resolve, redirects, sitemap and robots')
})

test('the full barrel is a superset of the edge barrel', () => {
  const full = read('index.ts')
  for (const m of ['types', 'resolve', 'redirects', 'sitemap', 'robots']) {
    assert.match(full, new RegExp(`'\\./${m}\\.ts'`), `index.ts must also export ${m}`)
  }
})
