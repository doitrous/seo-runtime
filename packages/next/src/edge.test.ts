import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = dirname(fileURLToPath(import.meta.url))
const read = (f: string) => readFileSync(join(src, f), 'utf8')

/** Every local module a file's `from './x.ts'` imports pulls in, one level. */
function localImports(file: string): string[] {
  return [...read(file).matchAll(/from '\.\/([\w-]+)\.ts'/g)].map((m) => `${m[1]}.ts`)
}

/**
 * A Next proxy/middleware bundle imports `@omary98/seo-runtime-next/edge`, never the package
 * root — `index.ts` imports the full `@omary98/seo-runtime-core` barrel (node:fs, node:sqlite,
 * node:crypto) at module scope for the rest of the runtime API, and a module runs every one of
 * its imports whether a given re-export uses them or not. `examples/next-demo`'s build failing
 * with `UnhandledSchemeError: node:crypto` the one time `proxy.ts` imported the package root is
 * exactly the regression this guards against.
 */
test('the next-package edge barrel never reaches index.ts or the full core barrel', () => {
  const seen = new Set<string>()
  const queue = ['edge.ts']
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    assert.notEqual(file, 'index.ts', 'edge.ts must not reach index.ts')
    const contents = read(file)
    assert.doesNotMatch(contents, /from '@omary98\/seo-runtime-core'/, `${file} imports the full core barrel, not /edge`)
    queue.push(...localImports(file))
  }
  assert.ok(seen.has('redirects.ts'), 'edge.ts should transitively reach redirects.ts')
})
