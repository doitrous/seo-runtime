import type { Snapshot } from './types.ts'

export function robotsTxt(snapshot: Snapshot | null): string {
  if (!snapshot) return 'User-agent: *\nAllow: /\n'
  const s = snapshot.settings
  if (!s.indexingEnabled) return 'User-agent: *\nDisallow: /\n'
  const base = (Object.values(s.baseUrls)[0] ?? '').replace(/\/+$/, '')
  const lines = ['User-agent: *', 'Allow: /', ...s.robotsExtra.filter(Boolean)]
  if (base) lines.push('', `Sitemap: ${base}/sitemap.xml`)
  return lines.join('\n') + '\n'
}
