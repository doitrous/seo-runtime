'use client'

import { useEffect, useState } from 'react'

/**
 * The minimal admin panel the ticket asks for: lists pending hub-approval jobs and gives each
 * one Preview/Approve/Reject/Publish-now buttons plus an approver-name input. A separate entry
 * point (`@omary98/seo-runtime-next/approval-panel`), not re-exported from the package root:
 * `index.ts` is imported by `handlers.test.ts` under plain `node --test`, which cannot load a
 * `.tsx` file — the same reason `jsonld.ts`'s own component stays a `.ts` file with `createElement`.
 *
 * Talks to this site's own `/api/seo/pending` + `/api/seo/{approve,reject,publish-now}` proxy
 * (see CONTRACT.md's "Pending/approve proxy") using the Bearer secret passed in as a prop — never
 * baked into the client bundle by this component itself.
 */
export function SeoApprovalPanel({ secret, apiBase = '/api/seo' }: { secret: string; apiBase?: string }) {
  const [jobs, setJobs] = useState<Array<{ id: string; title?: string; lang?: string; publishAt?: string; previewUrl?: string }>>([])
  const [approver, setApprover] = useState('')
  const [status, setStatus] = useState('')

  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }

  const load = async () => {
    const res = await fetch(`${apiBase}/pending`, { headers })
    const body = await res.json()
    if (!res.ok) { setStatus(`Failed to load: ${body.error ?? res.status}`); return }
    setJobs(body.jobs ?? [])
  }

  useEffect(() => { void load() }, [])

  const act = async (jobId: string, action: 'approve' | 'reject' | 'publish-now') => {
    if (!approver.trim()) { setStatus('Enter an approver name first.'); return }
    const res = await fetch(`${apiBase}/${action}`, { method: 'POST', headers, body: JSON.stringify({ jobId, approvedBy: approver.trim() }) })
    const body = await res.json()
    setStatus(res.ok ? `${action} ok: ${jobId}` : `failed: ${body.reason ?? body.error ?? res.status}`)
    void load()
  }

  return (
    <div>
      <h1>Pending SEO jobs</h1>
      <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Approver name" />
      <table>
        <thead><tr><th>Title</th><th>Lang</th><th>Publish at</th><th>Actions</th></tr></thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.title}</td>
              <td>{job.lang}</td>
              <td>{job.publishAt}</td>
              <td>
                {job.previewUrl && <a href={job.previewUrl} target="_blank" rel="noreferrer">Preview</a>}
                <button onClick={() => act(job.id, 'approve')}>Approve</button>
                <button onClick={() => act(job.id, 'reject')}>Reject</button>
                <button onClick={() => act(job.id, 'publish-now')}>Publish now</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{status}</p>
    </div>
  )
}
