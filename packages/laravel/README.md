# doitrous/seo-runtime-laravel

seo-hub runtime for Laravel: page SEO head tags, redirects, sitemap, robots, article ingest. See
the root `README.md` for install/config and `packages/CONTRACT.md` for the behaviour this package
implements.

## Head tags

`@seoHead` renders every hub-driven `<head>` tag for a path/lang in one call: title, description,
canonical, hreflang alternates, robots, OpenGraph/Twitter, the `google-site-verification` and
`msvalidate.01` metas (`settings.verification`), the JSON-LD blocks, and the GA4 `gtag.js` snippet
(`settings.ga4MeasurementId`, only when set). Every value comes from the synced snapshot and is
HTML-escaped; a malformed GA4 id is dropped rather than rendered.

Paste it inside `<head>`:

```blade
<head>
@seoHead('/' . $lang, $lang)
</head>
```

`Seo::head($path, $lang)` (the `Doitrous\SeoRuntime\Seo` facade) returns the same markup as a
string, for when a Blade directive isn't the right shape — the directive is a thin wrapper over it.

## Embeddable tools

`GET /tools/{slug}` renders the placeholder container the interactive calculator kit
auto-initialises (`.seo-tool-placeholder[data-kind][data-config]`) plus, once a snapshot has
synced, an "Embed this calculator" `<textarea>` with a copy-paste snippet (a cold store has no
origin to build an absolute iframe `src` from, so the section is omitted until then). Copy
`public/seo-tools.js` from [site-template](https://github.com/doitrous/site-template) into the
host app's own `public/` — the tool page's body already loads it.

`GET /tools/{slug}/embed` is the iframe-able view the copied snippet points at: `noindex, follow`
with a canonical back to `/tools/{slug}` so the embed never competes with the real page for
ranking, and no `X-Frame-Options`/`frame-ancestors` — any origin may frame it, the browser
default. Both routes' markup are ported byte-for-byte from site-template's
`packages/tools/embed.ts` and `app/tools/[slug]/embed/page.tsx`.

## Per-country pages (0.2.0)

Run `php artisan migrate`: `2026_10_06_000001_add_locale_to_seo_runtime_articles` adds
`locale`/`is_lead`/`hreflang` to `seo_runtime_articles`, backfills `locale = lang` and re-keys the
table to `(external_id, locale)`. Existing articles keep their URLs.

The first version of each language the hub sends (the lead) stays at `article_path`; the other
versions of that language are served at `/ar-ae/blog/{slug}` (override with
`seo-runtime.article_locale_path`, `fn (string $locale, string $slug): string`). Route the locale
prefix to the same article view and look the article up through the facade:

```php
Route::get('/{lang}/blog/{slug}', function (string $lang, string $slug) {
    $article = \Doitrous\SeoRuntime\Seo::article($lang, $slug);   // 'ar' → lead, 'ar-ae' → ar-AE
    abort_if(!$article, 404);

    return view('article', ['article' => $article]);   // $article['hreflang'] = every alternate
});
```

`Seo::parseLocalePrefix($path)` splits `/ar-ae/...` into `lang`/`locale`/`rest` (null for a path
that does not start with one of `seo-runtime.supported`), and `Seo::articleHref($article)` gives
a version's own path.
