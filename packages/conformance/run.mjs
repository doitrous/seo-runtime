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
  // Exit 0, not 2: this package is an npm workspace, so a bare `npm test` from the repo root
  // (`--workspaces --if-present`) invokes this script's own "test" with no flags and no env.
  // That sweep is for the unit-test workspaces; the conformance suite always needs a live demo
  // and is run explicitly (with real --base/--secret) from the README or CI — never from the
  // root's blanket test step. Skipping quietly here is what keeps that step green.
  console.log('conformance: skipped (no --base/--secret) — run with `node run.mjs --base <url> --secret <secret>`')
  process.exit(0)
}

const suiteDir = join(dirname(fileURLToPath(import.meta.url)), 'suite')

// One live store, one shared secret: every file drives the SAME demo through ascending snapshot
// versions (see suite/fixture.mjs), so files run ONE AT A TIME, in this fixed order. Running two
// at once — or out of order — races on the version and a later file's `stale` sync fails at
// random. Spawning `node --test <file>` once per file (rather than one `node --test a b c`
// invocation) is what guarantees that: each spawnSync call blocks until that file's process exits.
const files = ['sync', 'resolve', 'redirects', 'sitemap', 'robots', 'articles', 'health']

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
