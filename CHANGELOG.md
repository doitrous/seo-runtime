# Changelog

One version across every package (`@omary98/seo-runtime-core`, `-next`, `-express`,
`doitrous/seo-runtime-laravel`, the `doitrous-seo` WordPress plugin).

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
