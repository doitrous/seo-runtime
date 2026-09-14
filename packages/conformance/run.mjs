#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])

const base = args.get('base') ?? process.env.CONFORMANCE_BASE
const secret = args.get('secret') ?? process.env.CONFORMANCE_SECRET
const slug = args.get('slug') ?? process.env.CONFORMANCE_SLUG ?? 'demo'
if (!base || !secret) {
  // This suite always needs a live demo and is run explicitly, never from the repo root's
  // blanket `npm test`: packages/conformance's own package.json has no "test" script (it's
  // named "conformance" instead), so `npm run test --workspaces --if-present` skips this
  // workspace entirely rather than landing here with no flags. A real invocation missing its
  // flags is a usage error and must fail loud, not report a phantom success.
  console.error('usage: node run.mjs --base <url> --secret <secret> [--slug <slug>]')
  process.exit(2)
}

const suiteDir = join(dirname(fileURLToPath(import.meta.url)), 'suite')

// One live store, one shared secret: every file drives the SAME demo through ascending snapshot
// versions (see suite/fixture.mjs), so files run ONE AT A TIME, in this fixed order. Running two
// at once — or out of order — races on the version and a later file's `stale` sync fails at
// random. Spawning `node --test <file>` once per file (rather than one `node --test a b c`
// invocation) is what guarantees that: each spawnSync call blocks until that file's process exits.
const allFiles = [
  'sync', 'resolve', 'redirects', 'sitemap', 'robots', 'articles',
  // Phase 5: v2 fields/pages, AI-readability, and the pending/approve proxy. `pending` needs the
  // demo started with SEO_HUB_URL pointing at mock-hub.mjs — see that file's own docblock.
  'entities', 'readability', 'pending',
  'health',
]

// `--skip a,b` (or CONFORMANCE_SKIP) drops files by name. This exists for exactly one case: the
// WordPress job runs inside wp-env's Docker containers, which cannot reach a mock hub sitting on
// the CI host's own loopback (see .github/workflows/test.yml's wordpress job and mock-hub.mjs's
// docblock) — every *contract behaviour* still runs against WordPress with no exemption, `pending`
// is skipped there purely because the hub-proxy network path is unreachable from inside the
// container, and packages/wordpress/tests/v2.test.php already covers that route's own logic
// in-process. Not a general-purpose escape hatch — do not reach for this to skip a file that is
// merely failing.
const skip = new Set((args.get('skip') ?? process.env.CONFORMANCE_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const files = allFiles.filter((f) => !skip.has(f))

const env = {
  ...process.env,
  CONFORMANCE_BASE: base.replace(/\/+$/, ''),
  CONFORMANCE_SECRET: secret,
  CONFORMANCE_SLUG: slug,
}

for (const name of files) {
  const file = join(suiteDir, `${name}.test.mjs`)
  const res = spawnSync(process.execPath, ['--test', file], { stdio: 'inherit', env })
  if (res.status !== 0) {
    console.error(`\nconformance: suite/${name}.test.mjs failed — see packages/CONTRACT.md's "${name}" section`)
    process.exit(res.status ?? 1)
  }
}
