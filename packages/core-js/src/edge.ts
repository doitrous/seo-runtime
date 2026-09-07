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
export * from './redirects.ts'
export * from './sitemap.ts'
export * from './robots.ts'
// Type-only: `store.ts` is a bare interface over types already in this barrel (no node: imports
// of its own), and a `type`-only export is erased at build time, so this adds nothing to the
// bundle. Without it, `@doitrous/seo-runtime-next`'s edge-safe `withSeoRedirects` (which types its
// `store` parameter as `SeoStore`) would have no way to name that type without reaching into the
// full barrel — exactly the node:fs/node:sqlite pull-in this file exists to prevent.
export type { SeoStore } from './store.ts'
