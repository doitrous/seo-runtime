import { escapeHtml } from '@omary98/seo-runtime-core'

/**
 * The minimal admin panel the ticket asks for: lists pending jobs from `GET /api/seo/pending`
 * and gives each one Preview/Approve/Reject/Publish-now buttons plus an approver-name input.
 * Plain HTML + vanilla JS, no build step, no framework — this is a demo-grade admin page, not a
 * product UI. The secret is echoed into the page so the browser's own `fetch` calls can carry it
 * as `Authorization: Bearer` without a second prompt; it never touches `localStorage`.
 */
export function seoAdminHtml(secret: string): string {
  const e = escapeHtml
  return `<!doctype html><html><head><meta charset="utf-8"><title>SEO approvals</title>
<style>body{font-family:system-ui,sans-serif;max-width:840px;margin:2rem auto;padding:0 1rem}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:.5rem;text-align:left}
button{margin-right:.25rem}#approver{margin-bottom:1rem;padding:.25rem}</style></head>
<body>
<h1>Pending SEO jobs</h1>
<input id="approver" type="text" placeholder="Approver name" autocomplete="name">
<table id="jobs"><thead><tr><th>Title</th><th>Lang</th><th>Publish at</th><th>Actions</th></tr></thead><tbody></tbody></table>
<p id="status"></p>
<script>
// The secret is echoed here only because a browser can't set Authorization on the initial GET;
// it was already checked against the site's own configured secret before this page was served
// (the caller's timingSafeSecret check), and '<' is escaped the same way jsonLdBody escapes
// JSON-LD so it can never close this <script> tag early.
const secret = ${JSON.stringify(secret).replace(/</g, '\\u003c')};
const authHeaders = { 'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json' };
const statusEl = document.getElementById('status');
const approverEl = document.getElementById('approver');

async function loadPending() {
  const res = await fetch('/api/seo/pending', { headers: authHeaders });
  const body = await res.json();
  const tbody = document.querySelector('#jobs tbody');
  tbody.innerHTML = '';
  if (!res.ok) { statusEl.textContent = 'Failed to load: ' + (body.error || res.status); return; }
  for (const job of body.jobs || []) {
    const tr = document.createElement('tr');
    const cell = (text) => { const td = document.createElement('td'); td.textContent = text ?? ''; return td; };
    tr.appendChild(cell(job.title));
    tr.appendChild(cell(job.lang));
    tr.appendChild(cell(job.publishAt));
    const actions = document.createElement('td');
    if (job.previewUrl) {
      const a = document.createElement('a');
      a.href = job.previewUrl; a.target = '_blank'; a.textContent = 'Preview'; a.style.marginRight = '.5rem';
      actions.appendChild(a);
    }
    for (const action of ['approve', 'reject', 'publish-now']) {
      const btn = document.createElement('button');
      btn.textContent = action;
      btn.onclick = () => act(job.id, action);
      actions.appendChild(btn);
    }
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function act(jobId, action) {
  const approvedBy = approverEl.value.trim();
  if (!approvedBy) { statusEl.textContent = 'Enter an approver name first.'; return; }
  const res = await fetch('/api/seo/' + action, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ jobId, approvedBy }),
  });
  const body = await res.json();
  statusEl.textContent = res.ok ? (action + ' ok: ' + jobId) : ('failed: ' + (body.reason || body.error || res.status));
  loadPending();
}

loadPending();
</script>
</body></html>`
}
