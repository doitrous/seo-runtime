import type { Snapshot } from './types.ts'

/** No CR/LF: a UA name is one robots.txt line and must never be able to inject a second one. */
const safeUA = (ua: string) => String(ua ?? '').trim().replace(/[\r\n]/g, '')

export function robotsTxt(snapshot: Snapshot | null): string {
  if (!snapshot) return 'User-agent: *\nAllow: /\n'
  const s = snapshot.settings
  if (!s.indexingEnabled) return 'User-agent: *\nDisallow: /\n'
  const base = (Object.values(s.baseUrls)[0] ?? '').replace(/\/+$/, '')
  const lines = ['User-agent: *', 'Allow: /', ...s.robotsExtra.filter(Boolean)]
  // v2: per-UA blocks for named crawlers (GPTBot, ClaudeBot, …), each in its own block so one
  // UA's rule never bleeds into another's.
  for (const ua of s.crawlerPolicy?.allow ?? []) {
    const u = safeUA(ua)
    if (u) lines.push('', `User-agent: ${u}`, 'Allow: /')
  }
  for (const ua of s.crawlerPolicy?.disallow ?? []) {
    const u = safeUA(ua)
    if (u) lines.push('', `User-agent: ${u}`, 'Disallow: /')
  }
  if (base) lines.push('', `Sitemap: ${base}/sitemap.xml`)
  return lines.join('\n') + '\n'
}
