# seo-runtime

Per-stack SEO runtimes for the [seo-hub](https://github.com/omary98/seohub) platform. The hub
decides page SEO, redirects, sitemap and robots; these packages pull that decision into a local
store and render it — rendering never talks to the network. See `packages/CONTRACT.md` for the
behaviour every package implements and `packages/conformance/` for the suite that proves it.

| Package | Stack | Install |
|---|---|---|
| `@omary98/seo-runtime-core` | any JS | `npm i @omary98/seo-runtime-core` |
| `@omary98/seo-runtime-next` | Next.js 14+ app router | `npm i @omary98/seo-runtime-next` |
| `@omary98/seo-runtime-express` | Express 4/5 | `npm i @omary98/seo-runtime-express` |
| `doitrous/seo-runtime-laravel` | Laravel 10+ | composer, VCS repository (below) |
| `doitrous-seo` | WordPress 6+ | plugin zip from the GitHub releases |

`packages/conformance` is a stack-agnostic HTTP test suite: it drives each package's demo app
through the same checks and is the arbiter of any disagreement between `CONTRACT.md` and an
implementation.

## Configuration

Every runtime reads exactly three values — nothing else:

- `SEO_HUB_URL` — the hub's base URL
- `SEO_HUB_SECRET` — this site's Bearer secret, issued per site by the hub
- `SEO_SITE_SLUG` — this site's slug on the hub; optional once a snapshot has synced at least
  once (the stored snapshot carries its own slug), required before that on a cold store

Anything else a package needs — `store`, `pages`, `supported`, `onArticle`, `articlePath` — is a
code-level option passed at setup, never an environment variable.

## Install: Next.js (app router)

```
npm i @omary98/seo-runtime-next
```

Call `createSeo({ store, pages, supported, articlePath })` once and wire its pieces into the app
router's conventions (`generateMetadata`, `app/sitemap.ts`, `app/robots.ts`) — see
`examples/next-demo`. Redirects run from a `proxy.ts` at the project root built on
`withSeoRedirects`, imported from `@omary98/seo-runtime-next/edge` — never from the package root,
which pulls Node-only modules into the proxy bundle and fails the build.

Next's own router issues a 308 that strips a trailing slash *before* `proxy.ts` ever runs, which
pre-empts a real redirect on any source path with a trailing slash. Set this in `next.config.ts`
so trailing-slash handling goes through `withSeoRedirects` instead:

```ts
const nextConfig: NextConfig = { skipTrailingSlashRedirect: true }
```

## Install: Express

```
npm i @omary98/seo-runtime-express
```

```js
seoRuntime({ store, pages, supported, articlePath })(app)
```

Register it **before** any session or auth middleware: `seoRuntime(...)` reads its own request
bodies (redirects, `POST /api/seo/sync`, `POST /api/articles`) with its own 2 MB stream cap, and
mounting it first means it sees the raw stream rather than one already consumed downstream. See
`examples/express-demo`.

The package also registers `GET /seo-admin`: a minimal panel listing pending hub-approval jobs
with Preview/Approve/Reject/Publish-now buttons. It is secret-protected the same way every other
route is, but since a plain browser visit can't set a custom header, it also accepts the secret
as a query string: `GET /seo-admin?secret=...` (or `Authorization: Bearer ...`). Treat that URL
like a password — it belongs behind an internal link, never a public one.

## Install: Laravel

Composer resolves the package straight from this repository's VCS tag — no separate Packagist
publish:

```
composer config repositories.seo-runtime vcs https://github.com/omary98/seo-runtime
composer require doitrous/seo-runtime-laravel:^0.1
```

The service provider (`SeoRuntimeServiceProvider`) and the `Seo` facade auto-discover; nothing to
register by hand. Prepend the `seo.redirects` middleware to the `web` group so redirects apply
before the framework's own session/auth stack ever sees the request — in `bootstrap/app.php`
(Laravel 11+):

```php
->withMiddleware(fn (Middleware $m) => $m->prependToGroup('web', \Doitrous\SeoRuntime\Http\Middleware\SeoRedirects::class))
```

The provider registers the hub pull (every 6 h) and the health ping (hourly) on Laravel's own
scheduler — a running `php artisan schedule:work` (or the standard cron entry) is all a host needs;
there is no separate worker to deploy. The first pull happens automatically, on boot, the first
time the app serves a request after migrating (guarded so `artisan` commands and PHPUnit never
trigger it) — `php artisan seo-runtime:pull` still exists if you want to pull on demand.

## Install: WordPress

1. Download `doitrous-seo.zip` from this repository's [releases](../../releases), then upload it
   under Plugins → Add New → Upload Plugin, and activate it.
2. Define the three config values in `wp-config.php`:

   ```php
   define('SEO_HUB_URL', 'https://hub.example.com');
   define('SEO_HUB_SECRET', '...');
   define('SEO_SITE_SLUG', 'my-site');
   ```

3. Apache/FPM on most shared hosts strip the incoming `Authorization` header before PHP sees it.
   If every authenticated route 401s despite a correct secret, add this to `.htaccess`:

   ```
   SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
   ```

## IndexNow and the web-vitals beacon

Every package registers `POST /api/seo/indexnow` (this site's own secret): the hub calls it after
publishing a page, and the runtime forwards `{urlList}` to `https://api.indexnow.org/indexnow`
with `settings.indexNowKey` as the key — the runtime never calls IndexNow on its own, and this is
the *only* thing that calls it, so a hub that also called IndexNow directly would double-submit.
(The alternative the ticket allows — the hub calling IndexNow itself — is not implemented here.)

The web-vitals beacon is opt-in and never wired into the head automatically. Include it wherever
you want a page instrumented:

```js
// Express / plain HTML
res.send(html + webVitalsSnippet())   // webVitalsSnippet from @omary98/seo-runtime-core
```

```tsx
// Next
import { SeoWebVitals } from '@omary98/seo-runtime-next'
<SeoWebVitals />
```

```blade
{{-- Laravel --}}
{!! \Doitrous\SeoRuntime\Support\Entities::webVitalsSnippet() !!}
```

```php
<?php echo doitrous_seo_web_vitals_snippet(); ?>
```

It posts LCP/CLS/best-effort INP to this site's own `POST /api/seo/vitals` — a deliberately
anonymous route (a real visitor's browser is not a place to keep this site's secret) — which
attaches the secret server-side and relays the sample to the hub.

## Help index, editorial guidelines and the share block

Express and Laravel render two more pages, unconditionally: `GET /help` (an index of
`settings.helpEntries[]` for the requested language, filterable client-side, with a FAQPage
block) and `GET /editorial-guidelines` (the hub's pre-rendered `settings.editorialGuidelinesHtml`,
or a placeholder when unset). Laravel hosts that already have their own route at either path can
skip registering the package's own by setting `seo-runtime.routes.help` / `.editorial_guidelines`
to `false` in `config/seo-runtime.php` — see CONTRACT.md for the exact contract. Next doesn't
render pages itself; it exports `helpIndexBodyHtml`/`editorialBodyHtml` so a site can render its
own `/help` and `/editorial-guidelines` routes with them, the same way it uses `helpBodyHtml`.

Every author/help/tool page these packages render also gets a server-rendered share block
(WhatsApp/X/Facebook/LinkedIn/copy-link, `navigator.share` as a progressive upgrade) appended to
the body. Express and Laravel default this to `true` (`share: false` / `seo-runtime.share =
false` opts out) since they render the block themselves and can see it's wired in. Next has no
way to verify a site actually included `<ShareBlock/>`, so its `share` option — reported on the
health ping only — **defaults to `false`**; pass `share: true` to `createSeo` once `<ShareBlock/>`
is in place.

## Embeddable tools

`settings.tools[]` pages (`/tools/{slug}`) render a placeholder container the interactive
calculator kit auto-initialises (`.seo-tool-placeholder[data-kind][data-config]`) — copy
`public/seo-tools.js` from [site-template](https://github.com/doitrous/site-template) into the
site's own `public/`; the tool page's body already loads it (`<script src="/seo-tools.js"
defer>`).

The Express and Laravel packages render the same "Embed this calculator" section below every
tool page (once a snapshot has synced — a cold store has no origin to build an absolute iframe
`src` from, so the section is omitted) plus a matching `GET /tools/{slug}/embed` route: the
iframe-able view a copied snippet points at, `noindex, follow` with a canonical back to the real
`/tools/{slug}` page so the embed never competes with it for ranking, and no
`X-Frame-Options`/`frame-ancestors` — any origin may frame it, the browser default. Both the
snippet format and the embed page's resize protocol are copied byte-for-byte from
site-template's `packages/tools/embed.ts` and `app/tools/[slug]/embed/page.tsx`, so a page
embedded from any of these sites behaves identically.

## Releasing

1. Bump the version in `packages/core-js`, `packages/next`, `packages/express`,
   `packages/laravel/composer.json` and `packages/wordpress/doitrous-seo.php` — one version
   number across all five, and the same number in the `@omary98/seo-runtime-core` dependency of
   `-next` and `-express`.
2. `git tag vX.Y.Z && git push --tags`. The `publish-npm` workflow tests, builds and publishes the
   three npm packages in dependency order (core, then next, then express), and refuses to publish
   if the tag doesn't match every package's version. The `release-wp` workflow builds
   `doitrous-seo.zip` from `packages/wordpress` and attaches it to the GitHub release for that
   tag, creating the release if it doesn't already exist.
3. Composer needs nothing further: sites already pointed at this VCS repository resolve the new
   tag as soon as they `composer update`.

One-time setup: add an `NPM_TOKEN` repository secret (an npm automation token with publish rights)
before the first tag. The packages publish under `@omary98`, the scope every npm account owns
automatically for its own username, so no organization is needed — `publishConfig.access: public`
in each `package.json` makes the first publish public rather than a paid private package.
