# seo-runtime Laravel demo

A minimal Laravel 12 app that requires `doitrous/seo-runtime-laravel` (`packages/laravel`) via a
path repository, to prove the package's wiring — service provider, `Seo` facade, routes,
middleware, config and `@seoHead` Blade directive — against a real Laravel app, and to give the
conformance suite (`packages/conformance`) something to run against.

## What's here beyond a stock `laravel/laravel` skeleton

- `composer.json`'s `repositories.seo-runtime` points at `../../packages/laravel` and requires
  `doitrous/seo-runtime-laravel:@dev`.
- `bootstrap/app.php` prepends `Doitrous\SeoRuntime\Http\Middleware\SeoRedirects` to the global
  middleware stack, ahead of session/auth, per the package's own docblock and
  `packages/CONTRACT.md`'s Redirects section.
- `config/seo-runtime.php` is published from the package and sets `supported` to `['en', 'ar']`
  (a code-level option, never an env var — see `packages/CONTRACT.md`'s Configuration section) to
  match the conformance suite's bilingual fixtures.
- `routes/web.php` adds a real `/{lang}` page (`en`/`ar`) rendering `@seoHead(...)`, so the
  suite's JSON-LD escape test can assert against actual rendered HTML, not just the `/api/seo/probe`
  API.
- `public/robots.txt`, which the Laravel skeleton ships by default, is **removed**: the built-in
  PHP dev server serves a matching file under `public/` before Laravel ever routes the request, so
  a stock skeleton's `robots.txt` silently shadows the package's own `/robots.txt` route. Any host
  app that already has its own `/sitemap.xml` or `/robots.txt` (route or static file) must remove
  it for the same reason.

## Running it

```bash
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate --force
php artisan serve --port=8003
```

`.env.example` already carries `SEO_HUB_URL`, `SEO_HUB_SECRET=demo-secret` and
`SEO_SITE_SLUG=demo` — the only three environment variables this or any `seo-runtime` package
ever reads (`packages/CONTRACT.md`'s Configuration section).

## Running the conformance suite against it

With the server above still running:

```bash
node ../../packages/conformance/run.mjs --base http://127.0.0.1:8003 --secret demo-secret --slug demo
```

The suite drives the demo through ascending snapshot versions and is stack-agnostic — the same
command (with a different `--base`) runs against the Express and Next demos too.
