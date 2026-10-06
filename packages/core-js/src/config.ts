import { timingSafeEqual } from 'node:crypto'

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    hubUrl: (env.SEO_HUB_URL ?? '').replace(/\/+$/, ''),
    secret: env.SEO_HUB_SECRET ?? '',
    slug: env.SEO_SITE_SLUG ?? '',
  }
}

let warnedNoSlug = false

/**
 * One console.warn per process for the silent failure on a cold store: with no snapshot synced yet
 * and no SEO_SITE_SLUG there is nothing to address the hub with, so pull and health just return
 * 'failed'. Says so once instead of every 6 h / hourly.
 */
export function warnMissingSlug(): void {
  if (warnedNoSlug) return
  warnedNoSlug = true
  console.warn('[seo-runtime] SEO_SITE_SLUG is not set and no snapshot has synced yet, so the hub cannot be addressed: '
    + 'pull and health are skipped. Set SEO_SITE_SLUG until the first snapshot syncs (after that the stored snapshot carries the slug).')
}

/** Test hook: lets a test observe the once-per-process warning again. */
export function resetMissingSlugWarning(): void { warnedNoSlug = false }

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
