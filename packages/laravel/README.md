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
