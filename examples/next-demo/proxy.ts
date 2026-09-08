// `/edge`, not the package root: the package root barrel re-exports the full
// `@omary98/seo-runtime-core` (node:fs/node:sqlite/node:crypto stores + config.ts), and a module
// executes every one of its own imports whether this file uses them or not.
// Next 16's `proxy.ts` (the renamed `middleware.ts`) runs on the Node.js runtime by default, so
// `lib/store.ts`'s node:fs-backed `JsonFileStore` runs here with no edge-runtime restriction.
// Redirects already skip `/api`, `/admin` and `settings.reservedPrefixes` inside
// `withSeoRedirects` itself (see packages/CONTRACT.md's Redirects section) — the matcher below
// only needs to keep the proxy off Next's own static assets.
import type { NextRequest } from 'next/server'
import { withSeoRedirects } from '@omary98/seo-runtime-next/edge'
import { store } from './lib/store'

const redirects = withSeoRedirects(store)

export async function proxy(request: NextRequest) {
  return redirects({ url: request.url })
}

export const config = { matcher: ['/((?!_next).*)'] }
