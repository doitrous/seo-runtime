import type { NextConfig } from 'next'

// Without this, Next's own trailing-slash normalization (a 308 that strips the slash) runs
// BEFORE proxy.ts ever sees the request, so a redirect source hit with a trailing slash
// (packages/CONTRACT.md: normalization drops it before matching) answers Next's 308 instead of
// this site's real redirect. `skipTrailingSlashRedirect` hands that entirely to proxy.ts, whose
// `withSeoRedirects` already normalizes the path before matching.
const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
}

export default nextConfig
