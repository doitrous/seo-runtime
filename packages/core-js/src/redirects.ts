import type { StoredRedirect } from './types.ts'
import { normalizePath } from './types.ts'
import type { SeoStore } from './store.ts'

export const DEFAULT_RESERVED = ['/api', '/admin']

/** Whole-segment prefix match, so "/apifoo" is not covered by the "/api" reservation. */
export function isReserved(path: string, reserved: string[]): boolean {
  const p = normalizePath(path)
  return reserved.some((r) => {
    const prefix = normalizePath(r)
    return p === prefix || p.startsWith(`${prefix}/`)
  })
}

export function safeDestination(dest: string): string | null {
  const d = String(dest ?? '').trim()
  if (!d || d.startsWith('//')) return null
  if (d.startsWith('/')) return d
  return /^https:\/\/\S+$/i.test(d) ? d : null
}

export function matchRedirect(path: string, redirects: StoredRedirect[], reserved: string[]): StoredRedirect | null {
  if (isReserved(path, reserved)) return null
  const p = normalizePath(path)
  return redirects.find((r) => r.active && normalizePath(r.source) === p) ?? null
}

/**
 * The middleware entry point. Takes a full URL (or a path), returns the destination and status,
 * and counts the hit. Applied before any auth or session middleware, so it must never throw.
 */
export async function redirectFor(
  store: SeoStore, url: string, reserved: string[] = DEFAULT_RESERVED,
): Promise<{ destination: string; status: number } | null> {
  try {
    const path = normalizePath(url.startsWith('http') ? new URL(url).pathname : url)
    if (isReserved(path, reserved)) return null
    const row = await store.getRedirect(path)
    if (!row || !row.active) return null
    const destination = safeDestination(row.destination)
    if (!destination) return null
    await store.incrementHit(path)
    return { destination, status: [301, 302, 307, 308].includes(row.type) ? row.type : 301 }
  } catch {
    return null
  }
}
