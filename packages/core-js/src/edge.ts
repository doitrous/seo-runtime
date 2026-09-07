/**
 * The edge barrel. Everything a Next proxy / middleware needs and NOTHING that imports a Node
 * built-in: no node:fs, no node:sqlite, no node:crypto, no node:url. B3–B5 add `resolveSeo`,
 * `redirectFor` and the sitemap/robots builders here; nothing else may ever be added.
 *
 * A proxy that imports the full barrel drags the file and SQL stores into the middleware bundle
 * and the build fails. `packages/core-js/src/edge.test.ts` (B7 Step 8) is what keeps this honest.
 */
export * from './types.ts'
export * from './resolve.ts'
