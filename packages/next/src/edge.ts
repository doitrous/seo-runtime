/**
 * The edge barrel: only `withSeoRedirects`. `redirects.ts` itself reaches only into
 * `@omary98/seo-runtime-core/edge`, but importing `withSeoRedirects` from the package root
 * (`index.ts`) pulls in that file's own top-level import of the FULL core barrel — the one with
 * node:fs/node:sqlite/node:crypto stores — because a module executes all of its imports, used or
 * not. A Next proxy/middleware bundle that does `import { withSeoRedirects } from
 * '@omary98/seo-runtime-next'` fails to build for exactly that reason; importing from
 * `@omary98/seo-runtime-next/edge` instead never reaches `index.ts` at all.
 */
export { withSeoRedirects } from './redirects.ts'
