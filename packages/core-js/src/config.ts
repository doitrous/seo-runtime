import { timingSafeEqual } from 'node:crypto'

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    hubUrl: (env.SEO_HUB_URL ?? '').replace(/\/+$/, ''),
    secret: env.SEO_HUB_SECRET ?? '',
    slug: env.SEO_SITE_SLUG ?? '',
  }
}

export function bearerOf(header: string | null | undefined): string {
  const h = String(header ?? '')
  return /^bearer\s+/i.test(h) ? h.replace(/^bearer\s+/i, '') : ''
}

/**
 * Byte-length compared first because timingSafeEqual throws on unequal lengths, and an unset
 * secret never authorizes anything.
 */
export function timingSafeSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given), b = Buffer.from(expected)
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}
