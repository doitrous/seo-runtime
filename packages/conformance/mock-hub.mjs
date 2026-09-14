#!/usr/bin/env node
/**
 * A stand-in for seohub's pending/approve API (packages/CONTRACT.md's "Pending/approve proxy"
 * section), used only by suite/pending.test.mjs. Every stack's `/api/seo/pending` etc. just
 * forwards this site's request to `{SEO_HUB_URL}/api/sites/{slug}/...` with the site's own
 * secret as the hub's runtime Bearer — so a fixed job list and a fixed approve response here
 * exercise that pass-through path end to end without a real hub.
 *
 * Usage: MOCK_HUB_SECRET=<same secret the demo was started with> node mock-hub.mjs [port]
 * Then start the demo with SEO_HUB_URL=http://localhost:<port> (and the matching
 * SEO_HUB_SECRET/SEO_SITE_SLUG it already needs) — see .github/workflows/test.yml for exactly
 * how CI wires the three of them together.
 */
import http from 'node:http'

const PORT = Number(process.argv[2] ?? process.env.MOCK_HUB_PORT ?? 3199)
const SECRET = process.env.MOCK_HUB_SECRET ?? ''

const JOBS = [{ id: 'job-1', title: 'Conformance job', lang: 'en', publishAt: '2026-09-20T00:00:00.000Z', previewUrl: 'https://example.com/preview/job-1' }]

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${SECRET}`) return send(res, 401, { error: 'unauthorized' })

  if (req.method === 'GET' && /\/pending$/.test(req.url ?? '')) return send(res, 200, { jobs: JOBS })

  const approve = req.url?.match(/\/jobs\/([^/]+)\/(approve|reject|publish-now)$/)
  if (req.method === 'POST' && approve) {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* falls through to the missing-field check below */ }
      if (!body.approvedBy) return send(res, 400, { error: 'invalid' })
      send(res, 200, { status: 'ok', jobId: approve[1], action: approve[2] })
    })
    return
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, () => console.log(`mock-hub listening on http://localhost:${PORT}`))
