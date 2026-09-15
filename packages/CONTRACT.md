# The runtime contract

Every `seo-runtime` package implements exactly this. The conformance suite
(`packages/conformance/`) runs against each package's demo app and is the arbiter of any
disagreement between this document and an implementation.

## Configuration

`SEO_HUB_URL`, `SEO_HUB_SECRET` (per site), `SEO_SITE_SLUG`. Nothing else. A package that needs
another value takes it as a code-level option, never as an environment variable.

`SEO_SITE_SLUG` is optional only *after* a successful sync: the pull URL and the health body both
carry the slug, so on a cold store — which is exactly the boot state — an unset slug means the pull
cannot be addressed and the hub answers the health ping `400`. Once a snapshot is stored the
runtime falls back to `state.siteSlug` and the variable may be removed.

Code-level options (never environment variables), with their defaults:

| Option | Default | Purpose |
|---|---|---|
| `store` | — | required; the `SeoStore` implementation |
| `pages` | `() => []` | the site's page provider |
| `supported` | `['en']` | languages this site serves |
| `onArticle` | — | optional hook that takes over article storage |
| `articlePath` | `` (lang, slug) => `/${lang}/blog/${slug}` `` | where this site serves an article |

## Local store

Tables `seo_runtime_state`, `seo_runtime_pages`, `seo_runtime_redirects`, `seo_runtime_articles`,
created by the package's migration. They hold everything the hub decides. They are filled by the
hub push (`POST /api/seo/sync`) and by the runtime's own pull on boot and every 6 h
(`GET {hub}/api/sites/{slug}/snapshot`) — six hours on **every** stack, WordPress included.
Rendering reads the store only — never the network.

The table names carry the `seo_runtime_` prefix so a package can be installed next to a site's
own `seo_articles` / `seo_redirects` tables without colliding with them. The page key column is
named `page_key`, not `key`: `KEY` is a reserved word in MySQL and one of the four sites is MySQL.

The snapshot the hub sends is `{version, siteSlug, settings, pages, redirects}`. **It carries no
articles.** Articles reach a runtime only through `POST /api/articles`; that is what keeps the
snapshot body under the 2 MB limit however many articles a site has.

`SeoStore` is a per-key interface and the renderer uses it as one: `resolveSeo` reads
`getPage(path, lang)` and `listGroup(groupKey)`, and redirect matching reads `getRedirect(path)`.
No render path reads the whole store. `getSnapshot()` exists for sync and for the health counts.

## resolveSeo(path, lang)

Returns `{ title, description, canonical, robots: {index, follow}, alternates: {lang: url,
'x-default': url}, og, twitter, jsonld: [] }`.

Resolution order, field by field:

1. the hub page record for `(path, lang)`
2. the hub defaults for that page's type (`settings.pageDefaults[type]`)
3. the site settings defaults — `brandSuffix` appended to the title, `defaultOgImage`,
   `organization` rendered as the trailing JSON-LD entry

It never throws and never returns null. With an empty store it returns the settings defaults, and
with no settings at all it returns empty strings, `robots: {index: true, follow: true}` and `jsonld: []`.

`title` is the page's `seoTitle`; when that is empty the page `title` is run through the type's
`titleTemplate` (`%s` = the page title). The brand suffix is appended unless the title already ends
with it. When `settings.indexingEnabled` is false, `robots.index` is false for every page.

## Routes

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/articles` | Bearer secret | Spec-1 article payload. `200 {results, skipped}` \| `400 {error}` \| `401 {error:'unauthorized'}` \| `409 {error:'slug_taken', …}` \| `413 {error:'too large'}` \| any status an `onArticle` hook asks for (Aspects' `422 {error:'publication_gate'}`). |
| `POST /api/seo/sync` | Bearer secret | Full snapshot with a `version`. `200 {status:'applied'\|'stale', version}`. A snapshot whose `version` is lower than the stored one is ignored and answered `stale`. A body that is not a well-formed snapshot is `400 {status:'invalid'}` — never a 500. |
| `GET /api/seo/pages` | Bearer secret | `{pages: [{key, type, lang, path, title, updatedAt}]}` from the site's page provider, plus the runtime's own article pages at `articlePath(lang, slug)`. Each article appears exactly once per stored language. |
| `GET /api/seo/health` | **Bearer secret** | `{version, siteSlug, lastSyncAt, snapshotVersion, counts, redirectHits: [{source, hits}], share}` (at most 1,000 redirect entries, busiest first; the rest wait for the next ping). It names the site and enumerates every redirect source path, and it is the only route whose response resets state, so it is never anonymous. `share` defaults to true on Express and Laravel (opt out with `opts.share === false` / Laravel's `seo-runtime.share` config), but to **false on Next** — opt in with `share: true`, since Next never renders the block itself and so cannot verify a site actually placed it. A hub reading an older payload with no `share` key at all treats it as false. |
| `GET /api/seo/probe?path=&lang=` | Bearer secret | `resolveSeo` as JSON. Exists so the conformance suite can check resolution over HTTP on every stack; not part of rendering. |
| `GET /sitemap.xml` | none | See below. |
| `GET /robots.txt` | none | See below. |

`/sitemap.xml` and `/robots.txt` are the only anonymous routes.

Bearer secrets are compared timing-safe. Request bodies over 2 MB are refused with 413, and the
limit is enforced **on the stream**: `content-length` is absent on a chunked request, so every
stack reads the body through a counting reader and aborts the moment the byte count passes the
limit. Checking `content-length` alone is not conformant. The one exception is Laravel: PHP's SAPI
has already buffered the entire request body before any application code runs, so `SeoBodyLimit`
answers 413 off the fully buffered body rather than an in-flight byte count — the streaming abort
described above applies to the Node stacks only.

Redirect hit counters are drained **only after the hub answers 2xx** to the health ping. A ping
that fails to reach the hub loses no hits.

No runtime ships a page or controller that *renders* an article. Article HTML belongs to the site.
The runtime ingests articles and lists their URLs; that is all.

## Redirects

Exact path match after normalization (leading slash, no trailing slash, no query, no hash).
Types 301, 302, 307 and 308. Inactive rows never match. A hit increments a local counter that the
next health ping reports as a delta and then resets. Redirects are applied before any auth or
session middleware, and are skipped for `/api`, `/admin` and every prefix in
`settings.reservedPrefixes`. `/api` and `/admin` are reserved unconditionally: every stack unions
them into whatever `settings.reservedPrefixes` sends, so a hub-configured empty list can never
unreserve them.

Destinations must be site-relative (`/path`) or `https://…`; anything else is dropped at sync
time (`sanitizeSnapshot`/`Snapshot::sanitize`/`doitrous_seo_sanitize`, per stack). Every stack
also re-checks this at **render** time, on the read path (core-js's `redirectFor`, called by both
Express and Next; Laravel's `Snapshot::matchRedirect`; WordPress's `doitrous_seo_apply_redirect`)
— belt and braces against a stored row that predates sanitization, or one written by a lower-
level store call that bypassed it.

**Next.js trailing slashes.** Next's own router issues its own 308 to strip a trailing slash
*before* a proxy/middleware ever runs, which pre-empts the site's real redirect for any source
hit with a trailing slash. A Next site consuming `packages/next` for redirects must set
`skipTrailingSlashRedirect: true` in `next.config.ts` so trailing-slash handling goes through
`withSeoRedirects` (which already normalizes the path before matching) instead of Next's own
default. See `examples/next-demo/next.config.ts`.

## Sitemap

Pages with `includeInSitemap && index` and a non-missing record, plus every stored article URL per
language at `articlePath(lang, slug)`. `alternates` come from the page's `group`; `lastmod` from
`updatedAt`; `priority` from the page SEO, falling back to `settings.pageDefaults[type].priority`
and then to `0.5` — there is no per-type magic number; `changefreq` from
`settings.pageDefaults[type].changefreq`. Phase 1 ships a single `/sitemap.xml`; `sitemapXml` throws when the URL set exceeds 5,000 entries
rather than truncating silently. The sitemap index (`/sitemap-N.xml`) is deferred to phase 2.
When `settings.indexingEnabled` is false the sitemap is empty.

The articles the sitemap lists are the ones in the runtime's own store. A site that keeps its
articles elsewhere (an `onArticle` hook) lists them from its `pages` provider instead, so that
every article appears exactly once across the two sources.

## Robots

`User-agent: *`, `Allow: /`, then `settings.robotsExtra` lines, then `Sitemap: {base}/sitemap.xml`. When
`settings.indexingEnabled` is false the body is `User-agent: *` + `Disallow: /` and nothing else,
and every page renders `noindex`.

## Security

Timing-safe secret compare; 401 on failure; a 2 MB body limit enforced on the stream (not on
`content-length` alone); an inbound snapshot validated field by field before anything is
dereferenced, and a snapshot whose `siteSlug` is not this site's refused with
`400 {status:'invalid'}`; every rendered string escaped;
JSON-LD serialized with `<` escaped as `\u003c`; a JSON-LD override is dropped unless it has
`"@context": "https://schema.org"` and a string `"@type"`; redirect destinations validated as above.
In PHP the JSON-LD escape is `str_replace('<', '\u003c', …)` — writing `str_replace('<', '<', …)`
is a no-op and ships an XSS hole.

## Article ingest

`POST /api/articles` takes the spec-1 hub payload and answers:

| Status | When |
|---|---|
| `200 {results, skipped}` | stored, or updated in place — re-ingesting the same `(externalId, lang)` updates, it never duplicates |
| `400 {error}` | the payload is not a valid article payload |
| `401 {error:'unauthorized'}` | bad or missing Bearer |
| `409 {error:'slug_taken', slug, lang}` | that `(lang, slug)` already belongs to a **different** `externalId` |
| `413 {error:'too large'}` | body over 2 MB |
| anything the hook asks for | an `onArticle` hook may return `{status, …}`; those keys are passed through verbatim |

The 409 is not optional: every receiver returns it today and the hub's adapter uses it to tell
"pick another slug" apart from "the site is down". An `onArticle` hook that throws is caught and
answered `500 {error:'article_hook_failed', message}` — never an unhandled crash.

A slug is rejected only when it is empty, longer than 191 characters, or contains whitespace, `/`,
`?`, `#`, or a `..` segment. It is **not** required to be ASCII kebab-case: the sites serve Arabic
slugs and the hub has been sending them since spec 1.

## v2 fields (Phase 5, AI readability)

All additive, all optional, all backwards compatible with a phase-1 snapshot. Every one of them
lives inside `settings` — the one JSON blob every store already persists as a single
field/option/column — so **no store, migration or WordPress option schema changed** to carry
them.

| Field | On | Rendered as |
|---|---|---|
| `crawlerPolicy {allow: string[], disallow: string[]}` | `settings` | `robots.txt`: one `User-agent: {ua}` block per name in `allow` (`Allow: /`) and per name in `disallow` (`Disallow: /`), after the default `*` block and before `Sitemap:`. A UA name is stripped of `\r`/`\n` first — it is one line and must never inject a second one. |
| `entity` (a JSON-LD object) | `settings` | An extra `jsonld` entry on **every** resolved page (no route awareness in `resolveSeo`/`composeSeo` — this is the ticket's own fallback for a package with none, and it also covers `/` and `/about` because it covers every path). Dropped unless schema.org-shaped (`@context: https://schema.org` and a string `@type`), same rule as a page's `structuredData` override. |
| `authors[] {slug, name, title, credentials, sameAs[], bio}` | `settings` | `/authors/{slug}`, a page the runtime renders itself (unlike an article): `<h1>` name, title/credentials/bio, a `sameAs` link list, plus a `Person` JSON-LD block. 404 for an unknown slug. |
| `helpEntries[] {slug, lang, question, answerHtml, moneyPageUrl, updatedAt}` | `settings` | `/help/{slug}` (matched by `slug` **and** `lang`, `lang` from `?lang=`, default the site's first supported language): the question as `<h1>`, `answerHtml` (pre-rendered, trusted HTML from the hub — rendered as-is, like an article's `bodyHtml`) first, a link to `moneyPageUrl`, and an `Article` JSON-LD block with `headline` = the question and `dateModified` = `updatedAt`. Every entry for a language also lists at `GET /help` (below). |
| `tools[] {slug, lang, kind, config, methodologyHtml, dataSource, asOf}` | `settings` | `/tools/{slug}` (matched by `slug` and `lang` the same way): a placeholder container (`<div id="seo-tool-{slug}" data-kind data-config>`) the interactive kit mounts into at runtime, the `methodologyHtml` block, a `dataSource`/`asOf` line, and a `WebApplication` JSON-LD block. |
| `verification {googleMeta?, bingMeta?}` | `settings` | `<meta name="google-site-verification" content="{googleMeta}">` / `<meta name="msvalidate.01" content="{bingMeta}">` in the head, alongside every other head tag. |
| `indexNowKey` | `settings` | `GET /{key}.txt` → `200 text/plain`, body = the key, exactly. Every other path is untouched — this is a check against the one exact expected path, never a route/pattern broad enough to shadow a host's own top-level `*.txt` handling. |
| `ga4MeasurementId?` | `settings` | The gtag.js snippet (`<script async src="…/gtag/js?id={id}">` + the inline `gtag('config', …)` call), only when set. The id is checked against `^[A-Za-z0-9_-]+$` and dropped (not escaped) when it fails — it sits inside a JS string literal, not an HTML attribute. |
| `markets[] {country, lang, currency?}` | `settings` | Region-coded hreflang support (12-international-seo.md): carried through `resolveSeo`'s `alternates` unfiltered (any `lang` key a page group member carries, region-coded or not, is printed as-is — there is no allowlist against `settings` in that path). Not otherwise rendered by this package; the hub decides which region-coded keys to emit. |
| `editorialGuidelinesHtml?` | `settings` | `GET /editorial-guidelines` (01-site-setup.md): pre-rendered, trusted HTML from the hub, rendered as-is like a help entry's `answerHtml` — an `<h1>Editorial guidelines</h1>` followed by the HTML, or a placeholder when unset. Always `200`, never `404`. |

`resolveSeo`'s returned shape gains two more optional keys, `verification` and
`ga4MeasurementId`, copied straight from `settings` — every stack's head-tag renderer needs them
and this is one fetch instead of a second one per render. Laravel renders all of the above —
verification metas, the JSON-LD blocks, and the GA4 snippet — through `Seo::head()`/the `@seoHead`
Blade directive (`packages/laravel/resources/views/head.blade.php`), the same one call a host app
pastes into `<head>` for the rest of this table's page-level metadata too.

Author/help/tool pages are the one exception to "no runtime ships a controller that renders an
article" (Article ingest, above): the ticket asks the runtime to render these three new page
types itself, not just resolve metadata for them. They are otherwise ordinary anonymous GET
routes, same risk profile as `/sitemap.xml` and `/robots.txt` — a specific literal prefix, never a
generic catch-all.

**V2-PHASE-8 (`GET /help`, `GET /editorial-guidelines`, the share block, locale-free hreflang).**
`GET /help` is the help index (06-help-page.md): every `helpEntries[]` entry for `?lang=` (default
the site's first supported language), a client-side search filter, and a `FAQPage` block for the
first 10 questions — `core-js`'s `helpIndexBodyHtml(settings, lang)`, shipped by Express and
Laravel; site-template's own `app/help/page.tsx` calls the same function for the Next stack, since
Next renders its own pages rather than having this package render them. It always answers `200`,
even with zero entries. `GET /editorial-guidelines` (01-site-setup.md) is
`editorialBodyHtml(settings)` the same way — always `200`. Both are shipped by Express and
Laravel; a Next site wires them itself (`helpIndexBodyHtml`/`editorialBodyHtml` are re-exported
from `@omary98/seo-runtime-next` for exactly that).

On Laravel, both routes can be turned off with `seo-runtime.routes.help` /
`seo-runtime.routes.editorial_guidelines` (default `true`): a host app that already has its own
route at `/help` or `/editorial-guidelines` sets the matching flag to `false`, or removes its own
route — the same either/or as a host app that already defines `/sitemap.xml` or `/robots.txt`
must remove them (above). The flag gates only the route this ticket added; `/help/{slug}` (v2,
phase 5) is unconditional on every stack. Express and Next have no equivalent flag: a host
Express app controls this by *not* mounting `seoRuntime(...)` ahead of its own conflicting route,
and a Next site owns its own `app/` tree already.

The share block (01-site-setup.md §5) — server-rendered WhatsApp/X/Facebook/LinkedIn/copy-link
anchors plus a small inline script that upgrades a hidden "Share" button to `navigator.share()`
when the browser has it (`entities.ts`'s `shareBlockHtml({url, title})`) — is appended to every
author/help/tool page (and the two routes above) on **Express and Laravel by default** (opt out
with `opts.share === false` / Laravel's `seo-runtime.share` config). **Next defaults the other
way, to opt-in** (`config.share` must be explicitly `true`): unlike Express/Laravel, which append
the block to the HTML they render themselves, the Next package never renders a page and so has no
way to verify a site actually placed `<ShareBlock url title />` somewhere — reporting `share: true`
by default would be a health-ping lie about markup the package never touches. `<ShareBlock/>` is a
server component (`@omary98/seo-runtime-next`) a site includes itself, same pattern as
`<SeoJsonLd/>`. The share block is never appended to `/tools/{slug}/embed`, which stays a minimal
iframe-able view, on any stack.

`GET /help`, `GET /help/{slug}`, `GET /editorial-guidelines`, `GET /authors/{slug}` and
`GET /tools/{slug}` are matched by `?lang=`, not a path segment, so they carry no stored page
record for `resolveSeo`'s page-group `alternates` to build from — that lookup is always empty for
these five paths. `core-js`'s `localeFreeAlternates(supported, path)` fills that gap: given the
site's supported-language list and the bare path (no query), it returns
`{[lang]: "path?lang=lang", ..., 'x-default': "path?lang=" + supported[0]}` for every configured
language, which Express and Laravel splice into `seo.alternates` before rendering the page's head
tags (the current language's own URL is still the page's `canonical`, computed separately by
`resolveSeo`/`Snapshot::resolve`). Exported for Next the same way `helpIndexBodyHtml` is, for a
site to use in its own `generateMetadata`. Never applied to `/tools/{slug}/embed`, which stays
canonical-only (`noindex`).

`/tools/{slug}/embed` is the iframe-able view of a tool, shipped by **Express and Laravel only**
(this is not a package-wide row — `packages/next`'s `toolBodyHtml(tool)` call and
`packages/wordpress` are both untouched by this section; a Next site gets the equivalent from
site-template's own `app/tools/[slug]/embed/page.tsx` at the application level instead, and
WordPress support is pending). On those two stacks: the same placeholder container, a link back
to `/tools/{slug}` (`target="_top"`), and an inline `ResizeObserver` that posts
`{seoToolHeight}` to the parent — the tool page itself carries the matching "Embed this
calculator" `<textarea>` (an `embedSnippet`/`toolEmbedHtml` pair per stack) once a snapshot has
synced; on a cold store there is no origin to build an absolute iframe `src` from, so the section
is omitted rather than emitting a broken one. The embed route's `resolveSeo` is overridden to
`robots: {index: false, follow: true}` and its `canonical` points at `/tools/{slug}`, never at
the embed path itself, so the embed never competes with the real page for ranking. No
`X-Frame-Options` / `frame-ancestors` anywhere — any origin may frame it, the browser default.
The snippet format and the embed page's resize protocol are ported byte-for-byte from
site-template's `packages/tools/embed.ts` and `app/tools/[slug]/embed/page.tsx` so a page
embedded from any of these sites behaves identically. `embedSnippet` encodes a hub-supplied slug
(`encodeURIComponent`/`rawurlencode`) before splicing it into the snippet's `src`/`href`
attributes, since it is untrusted input, not developer-authored config.

## Pending/approve proxy (Phase 5)

Every stack proxies the hub's site-side approval API (`packages/CONTRACT.md` of `seohub`'s Phase
1: `GET /api/sites/:slug/pending`, `POST /api/sites/:slug/jobs/:id/approve|reject|publish-now`)
behind its own runtime secret:

| Route | Proxies | Auth in | Auth out |
|---|---|---|---|
| `GET /api/seo/pending` | `GET {hub}/api/sites/{slug}/pending` | this site's `SEO_HUB_SECRET` (Bearer) | the same secret, as the hub's runtime Bearer |
| `POST /api/seo/approve` | `POST {hub}/.../jobs/{id}/approve` | ditto | ditto |
| `POST /api/seo/reject` | `POST {hub}/.../jobs/{id}/reject` | ditto | ditto |
| `POST /api/seo/publish-now` | `POST {hub}/.../jobs/{id}/publish-now` | ditto | ditto |

Body `{jobId, approvedBy, note?}` in (`jobId` addresses the hub's `:id`; `approvedBy`/`note` pass
straight through to the hub's `{approvedBy, note?}`); the hub's status and body are passed through
verbatim, including a `409 {error:'publish_blocked', reason}` block. A minimal admin panel per
stack (Next `SeoApprovalPanel`, Express `GET /seo-admin`, Laravel a blade view + route, WordPress
an admin submenu page) lists pending jobs with Preview/Approve/Reject/Publish-now buttons and an
approver-name input, authenticated the same way the runtime secret protects everything else.

## IndexNow submission and the web-vitals beacon (Phase 5)

| Route | Auth | Forwards to | Body |
|---|---|---|---|
| `POST /api/seo/indexnow` | this site's `SEO_HUB_SECRET` (Bearer) | `https://api.indexnow.org/indexnow` | in: `{urlList}`; out: `{host, key, keyLocation, urlList}` with `settings.indexNowKey` as `key` — the same key served at `GET /{key}.txt` above, which is what lets IndexNow's own key check succeed |
| `POST /api/seo/vitals` | **none** — see below | `{hub}/api/runtime/vitals` | in: `{url, lcp?, inp?, cls?}`; out: the same plus `{siteSlug, source:'rum'}`, with this site's `SEO_HUB_SECRET` as the hub's runtime Bearer |

**IndexNow.** Every URL in one `urlList` must share the batch's own host (IndexNow's own rule); a
URL for a different host is dropped rather than sent, since IndexNow rejects the *whole* batch on
a host mismatch, not just that one URL. The hub is expected to call this route after it publishes
— a runtime never calls IndexNow directly on its own, and the hub never gets a second, unproxied
path to a site's IndexNow key.

**The web-vitals beacon** is opt-in at the integration level, not gated by a snapshot field: each
core package exports a `webVitalsSnippet()` a site includes itself (Express/Next/Laravel/
WordPress all name it the same way in their own language) wherever it wants a beacon, the same
way `SeoGtag`/`gtagSnippet` is an explicit component rather than something baked into every head.
It is never auto-included by `injectHead`/`headTags`, unlike the gtag snippet.

The beacon's own route (`POST /api/seo/vitals`) takes **no secret from the caller** — it runs in a
real visitor's browser, which is not a place to keep this site's secret, so the route is
deliberately outside every stack's normal `seo.secret`/`authorized`/bearer-check path. The site's
secret is attached only on the way *out*, to the hub, from server-side code — the same pattern as
every hub-proxy route above, just with the auth direction reversed on the way in. Metrics are
read straight off the browser's own `PerformanceObserver` (`largest-contentful-paint`,
`layout-shift`, and a best-effort `event` for INP) — no `web-vitals` npm/composer dependency,
since that library itself is a thin wrapper over the same three observer types.

## Versioning

The package version is reported in `GET /api/seo/health`. The hub compares it against the site's
`runtimeMinVersion` and shows "runtime outdated" when it is lower.
