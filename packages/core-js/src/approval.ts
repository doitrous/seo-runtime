import type { SeoStore } from './store.ts'
import { readConfig } from './config.ts'

export type ApprovalAction = 'approve' | 'reject' | 'publish-now'
export type ApprovalNote = { approvedBy: string; note?: string }
export type ProxyResult = { status: number; body: unknown }
export type WebVitalsSample = { url: string; lcp?: number; inp?: number; cls?: number }

/**
 * Same fallback `pullSnapshot`/`sendHealth` use: `SEO_SITE_SLUG` is optional once a snapshot has
 * synced (it carries its own `siteSlug`), required before that on a cold store.
 */
async function resolveSlug(store: SeoStore, cfg: ReturnType<typeof readConfig>): Promise<string> {
  return cfg.slug || (await store.getSnapshot())?.siteSlug || ''
}

async function hubFetch(cfg: ReturnType<typeof readConfig>, path: string, init: RequestInit = {}): Promise<ProxyResult> {
  try {
    const res = await fetch(`${cfg.hubUrl}${path}`, {
      ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${cfg.secret}` },
    })
    const text = await res.text()
    let body: unknown = null
    if (text) { try { body = JSON.parse(text) } catch { body = text } }
    return { status: res.status, body }
  } catch {
    return { status: 502, body: { error: 'hub_unreachable' } }
  }
}

/** `GET {hub}/api/sites/{slug}/pending`, this site's secret in, the hub's runtime secret out. */
export async function proxyPending(store: SeoStore, cfg = readConfig()): Promise<ProxyResult> {
  if (!cfg.hubUrl || !cfg.secret) return { status: 502, body: { error: 'misconfigured' } }
  const slug = await resolveSlug(store, cfg)
  if (!slug) return { status: 502, body: { error: 'misconfigured' } }
  return hubFetch(cfg, `/api/sites/${encodeURIComponent(slug)}/pending`)
}

/**
 * `POST {hub}/api/sites/{slug}/jobs/{jobId}/{action}`, body `{approvedBy, note?}`. The hub's
 * status and body — including `{error:'publish_blocked', reason}` — are passed through verbatim;
 * this never re-shapes the hub's answer.
 */
export async function proxyApprovalAction(
  store: SeoStore, action: ApprovalAction, jobId: string, note: ApprovalNote, cfg = readConfig(),
): Promise<ProxyResult> {
  if (!cfg.hubUrl || !cfg.secret) return { status: 502, body: { error: 'misconfigured' } }
  if (!jobId || !note?.approvedBy) return { status: 400, body: { error: 'invalid' } }
  const slug = await resolveSlug(store, cfg)
  if (!slug) return { status: 502, body: { error: 'misconfigured' } }
  return hubFetch(cfg, `/api/sites/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy: note.approvedBy, ...(note.note ? { note: note.note } : {}) }),
  })
}

/**
 * `POST {hub}/api/runtime/vitals`, `source: 'rum'` (packages/CONTRACT.md's v2 IndexNow/vitals
 * section) — the hub stores it in `crux_samples` next to whatever it already pulls from CrUX.
 * Same shape as `sendHealth`'s own hub call: no per-site path segment, `siteSlug` carried in the
 * body instead. The opt-in client beacon (`webVitalsSnippet`, in entities.ts) never holds this
 * site's secret — a real visitor's browser is not a place to keep one — it posts to this site's
 * own `POST /api/seo/vitals` instead, and the secret is attached here, server-side, exactly like
 * every other hub-proxy call in this file.
 */
export async function submitVitals(store: SeoStore, sample: WebVitalsSample, cfg = readConfig()): Promise<ProxyResult> {
  if (!cfg.hubUrl || !cfg.secret) return { status: 502, body: { error: 'misconfigured' } }
  if (!sample?.url) return { status: 400, body: { error: 'invalid' } }
  const slug = await resolveSlug(store, cfg)
  if (!slug) return { status: 502, body: { error: 'misconfigured' } }
  return hubFetch(cfg, '/api/runtime/vitals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteSlug: slug, url: sample.url, lcp: sample.lcp, inp: sample.inp, cls: sample.cls, source: 'rum' }),
  })
}
