// Reference wiring for a real site's `middleware.ts`, not this demo's own: Next only runs a file
// named exactly `middleware.ts` at the project root, and this demo doesn't ship one. The reason is
// this file's own `store` — `lib/store.ts`'s `JsonFileStore` is a node:fs-backed implementation,
// and node:fs cannot be bundled for (or run in) Next's Edge middleware runtime at all. A real site
// wires this same call into its own `middleware.ts` with an edge-compatible `SeoStore` (an HTTP or
// KV-backed implementation, not a local file), e.g.:
//
//   import type { NextRequest } from 'next/server'
//   import { proxy } from './proxy'
//   export { config } from './proxy'
//   export const middleware = (req: NextRequest) => proxy({ url: req.url })
//
// Imports the store, not `lib/seo.ts`: the runtime instance is a server-side object (and on a
// real site may hold a database client created at module load), while a proxy is bundled for the
// edge runtime and needs only the store.
//
// `/edge`, not the package root: `@doitrous/seo-runtime-next`'s own `index.ts` imports the full
// `@doitrous/seo-runtime-core` barrel (node:fs, node:sqlite, node:crypto) for its other exports,
// and a module executes every one of its imports whether this file uses them or not — so pulling
// `withSeoRedirects` from the package root drags all of that into the edge bundle and the build
// fails. `@doitrous/seo-runtime-next/edge` re-exports only `withSeoRedirects`, from a module that
// itself never reaches past `@doitrous/seo-runtime-core/edge`.
import { withSeoRedirects } from '@doitrous/seo-runtime-next/edge'
import { store } from './lib/store'

export const proxy = withSeoRedirects(store)
export const config = { matcher: '/:path*' }
