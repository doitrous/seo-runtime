# Conformance

    node run.mjs --base http://localhost:3101 --secret demo-secret --slug demo

Flags fall back to env vars: `CONFORMANCE_BASE`, `CONFORMANCE_SECRET`, `CONFORMANCE_SLUG` (default
`demo`).

Runs the whole contract (`packages/CONTRACT.md`) against any running app. The app must serve
`GET /api/seo/probe` (the contract's conformance probe) and must be started with `SEO_HUB_SECRET`
equal to `--secret`.

The suite writes into the app's store — snapshots and a few articles — so run it against a demo
app, never against production.

## Serial, in a fixed order

The files share one live store and drive it through ascending snapshot versions
(`suite/fixture.mjs`'s `nextVersion()`, seeded from `Date.now()` so a version always beats
whatever a previous run left on disk). `run.mjs` runs them **one file at a time, in this fixed
order** — `sync, resolve, redirects, sitemap, robots, articles, entities, readability, pending,
health` — spawning a fresh
`node --test <file>` for each and stopping at the first non-zero exit. Do not run
`node --test suite/` yourself: concurrent files race on the version and fail at random, and
`run.mjs` also prints which contract section (file) failed, which a raw `node --test` invocation
does not.

## The pending/approve proxy

`suite/pending.test.mjs` is the one file that needs more than `--base`/`--secret`: it drives the
real hub-proxy path, so the demo under test must be started with `SEO_HUB_URL` pointing at a
running `node mock-hub.mjs` (same directory), started first with `MOCK_HUB_SECRET` equal to the
demo's own `SEO_HUB_SECRET`/`--secret`. See `mock-hub.mjs`'s own docblock and
`.github/workflows/test.yml` for exactly how CI wires the three together.

## WordPress

`wp-env start` in `packages/wordpress` boots WordPress with the plugin mounted at
http://localhost:8888; run the suite with `--base http://localhost:8888`. Where `wp-env` is not
available, install the plugin on a scratch site, set the two constants in `wp-config.php` and run
the same command against that host. Both paths run the identical suite — the WordPress package
gets no exemptions on contract *behaviour*.

The one infra exception is `suite/pending.test.mjs`: it needs the demo to reach a mock hub over
the network (see "The pending/approve proxy" above), and wp-env's WordPress runs inside a Docker
container that cannot reach a process bound to the CI host's own loopback. `.github/workflows/
test.yml`'s `wordpress` job runs everything else and passes `--skip pending` for that one file —
`packages/wordpress/tests/v2.test.php` already covers the same proxy logic in-process. `--skip` is
not a general escape hatch; nothing else in this suite has a reason to reach for it.
