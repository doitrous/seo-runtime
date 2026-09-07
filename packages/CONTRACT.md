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
| `GET /api/seo/health` | **Bearer secret** | `{version, siteSlug, lastSyncAt, snapshotVersion, counts, redirectHits: [{source, hits}]}` (at most 1,000 entries, busiest first; the rest wait for the next ping). It names the site and enumerates every redirect source path, and it is the only route whose response resets state, so it is never anonymous. |
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

Destinations must be site-relative (`/path`) or `https://…`; anything else is dropped at sync time.

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

## Versioning

The package version is reported in `GET /api/seo/health`. The hub compares it against the site's
`runtimeMinVersion` and shows "runtime outdated" when it is lower.
