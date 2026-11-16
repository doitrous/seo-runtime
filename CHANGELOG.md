# Changelog

One version across every package (`@omary98/seo-runtime-core`, `-next`, `-express`,
`doitrous/seo-runtime-laravel`, the `doitrous-seo` WordPress plugin).

## 0.2.3 — WordPress: Polylang language and translations for hub posts, no duplicate head tags

WordPress plugin only; the other packages are bumped to keep one version.

- **Polylang.** Posts the hub's `wordpress` adapter writes over `/wp-json/wp/v2/posts` now get
  their Polylang language and are linked as translations. The plugin registers two REST meta keys,
  `seo_hub_lang` (the post's language) and `seo_hub_translations` (JSON `{lang: post id}`), and on
  `rest_after_insert_post` calls `pll_set_post_language()` / `pll_save_post_translations()`. That
  action fires after the request's meta is saved and before the response is built, so the
  response's `link` is already the language's URL (`/en/...`). Languages Polylang does not have
  are ignored; without Polylang nothing happens. Needs the hub adapter that sends these keys.
- **Fix.** The Yoast/RankMath meta keys and `seo_hub_hreflang` the adapter writes are registered
  for the REST API. The docs said the plugin did this since it replaced the `seo-hub.php`
  mu-plugin, but it did not, so WordPress silently dropped them.
- **Fix: duplicate `<title>`.** On a hub page of a site without Yoast/Rank Math, the theme's
  title-tag support printed a second `<title>`: an empty `pre_get_document_title` does not
  short-circuit core. `_wp_render_title_tag` is now removed on hub pages.
- **Fix: duplicate hreflang with Polylang.** On a hub page where the plugin prints alternates,
  Polylang's own `<link rel="alternate" hreflang>` set is emptied (`pll_rel_hreflang_attributes`).
- Both are done on `wp`, before `wp_head` runs: core's title tag and Polylang's hreflang share
  `wp_head` priority 1 with the plugin's head, and a callback removed while its priority is
  running still fires.

## 0.2.2 — per-country article URLs name themselves in the sitemap

- **Fix.** A snapshot page whose URL is a stored article version now carries that article's full
  hreflang set in the sitemap (core-js, Laravel, WordPress). Its page group is keyed by plain
  `lang`, so `/blog/ar-ae/x` listed only `ar`, `en` and `x-default`, never itself. The page is still
  the entry, with its own `lastmod`, `priority` and noindex. `x-default` on these pages now follows
  the article's rule (the source version, or `en` for a payload without `locale`).
- **Contract.** Documents the optional `group` on `GET /api/seo/pages`.
- Conformance: new case in `suite/locales.test.mjs`.

## 0.2.0 — per-country pages (hub contract 1.20.0)

Several pages per language, one per country (ar-SA, ar-AE, ar-LY, ar-EG). See the root README's
"Per-country pages" section for what a host site must do, and `packages/CONTRACT.md`'s section of
the same name for the rules.

- **Ingest.** Article items accept `locale` (validated against the item's `lang`, canonicalised
  to `ar-AE`). The first item of each language is its lead and keeps `articlePath(lang, slug)`;
  every other version is served at `articleLocalePath(locale, slug)` — by default the language
  segment swapped for the lowercase locale (`/ar/blog/x` → `/ar-ae/blog/x`), or `/<locale>`
  prepended to an unprefixed language. Results carry `locale` (when sent); a non-lead's
  `remoteId` is `{externalId}:{locale}`. The 409 slug check runs per locale.
- **Storage.** Articles are keyed by `(externalId, locale)` with new `locale`, `lead` and
  `hreflang` fields. Migrations: core-js `SqlStore.migrate()` upgrades a 0.1.x table in place
  (SQLite rebuild, Postgres/MySQL `ALTER`), Laravel ships
  `2026_10_06_000001_add_locale_to_seo_runtime_articles`, WordPress re-keys its table on
  `plugins_loaded`. Every existing row is backfilled `locale = lang`, `lead = true` and keeps its
  URL; a 0.1.x row is updated in place (never duplicated) when the hub starts sending `locale`.
- **hreflang** is computed by the receiver from every stored version of the externalId (every
  locale, each language → its lead, `x-default` → the source), stored on each version and printed
  in the sitemap, which now lists one `<url>` per version. Payloads without `locale` keep the
  0.1.6 x-default rule (`en`, else the first language).
- **Lookup helpers** for host routing: core-js `getArticle`, `parseLocalePrefix`,
  `articleVersionPath`, `localizePath`, `canonicalLocale`; Next `seo.article`,
  `seo.articleMetadata`, `seo.articleHref` (and `parseLocalePrefix` from `/edge`); Express
  `res.locals.getArticle` / `res.locals.articleHref`; Laravel `Seo::article`,
  `Seo::articleHref`, `Seo::parseLocalePrefix`; WordPress `doitrous_seo_get_article`,
  `doitrous_seo_parse_locale_prefix`. `findArticleBySlug` accepts a language or a locale.
- **Health** reports `features: ["localeUrls"]` on every stack.
- New option `articleLocalePath` (Next/Express), `seo-runtime.article_locale_path` (Laravel),
  filter `doitrous_seo_article_locale_path` (WordPress).
- Conformance: new `suite/locales.test.mjs`.
- Fix: `JsonFileStore` no longer shares one empty-state object between stores on a missing file.

**Backward compatibility.** A payload without `locale` is answered exactly as 0.1.6 (same
results, same URLs, same sitemap). A site's own `SeoStore` written for 0.1.x keeps working for
such payloads; it must key by locale before the hub's `localeUrls` flag is turned on for that site.
