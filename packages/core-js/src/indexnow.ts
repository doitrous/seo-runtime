import type { Settings } from './types.ts'
import type { ProxyResult } from './approval.ts'

// No node: imports — same reasoning as approval.ts (a plain `fetch` call), so this could live in
// the edge barrel too, but isn't: submitting IndexNow is a one-off server action triggered by a
// route, never something a proxy/middleware needs on every request, so it stays out of edge.ts
// the same way approval.ts does.

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

/**
 * `POST /api/seo/indexnow` (packages/CONTRACT.md's v2 IndexNow/vitals section): this site's own
 * secret in (checked by the route's own auth middleware, same as every other `/api/seo/*` route
 * — not repeated here), then forwards `urlList` to IndexNow with `settings.indexNowKey` — the
 * same key served at `/{key}.txt` (`indexNowKeyFile`, above), which is exactly what lets
 * IndexNow's own key verification succeed. The hub is expected to call this after it publishes
 * (rather than calling IndexNow itself), so the runtime never has to trust a second caller with
 * the site's IndexNow key — see README.md for why this is the one of the two the ticket asks a
 * stack to "choose and document."
 *
 * IndexNow requires every URL in one batch to share the same host as the batch's own `host`
 * field; a URL for a different host is dropped rather than sent, since a mismatched host fails
 * IndexNow's validation for the *whole* batch, not just that one URL.
 */
export async function submitIndexNow(settings: Settings, urlList: unknown): Promise<ProxyResult> {
  const key = settings.indexNowKey
  if (!key) return { status: 502, body: { error: 'misconfigured' } }
  if (!Array.isArray(urlList) || urlList.length === 0) return { status: 400, body: { error: 'invalid' } }

  let host: string
  try { host = new URL(String(urlList[0])).host } catch { return { status: 400, body: { error: 'invalid' } } }
  const urls = urlList.filter((u) => { try { return new URL(String(u)).host === host } catch { return false } })
  if (!urls.length) return { status: 400, body: { error: 'invalid' } }

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls }),
    })
    const text = await res.text()
    return { status: res.status, body: text || { status: res.status } }
  } catch {
    return { status: 502, body: { error: 'indexnow_unreachable' } }
  }
}
