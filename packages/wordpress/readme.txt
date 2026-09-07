=== Doitrous SEO ===
Contributors: doitrous
Tags: seo, redirects, sitemap, robots
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 8.0
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

The seo-hub runtime for WordPress: the hub decides page SEO, redirects, sitemap and robots;
this plugin renders them and ingests articles the hub pushes.

== Description ==

This plugin is a thin runtime, not a general SEO plugin. It:

* pulls a signed snapshot (`settings`, `pages`, `redirects`) from the hub on activation and
  every six hours, and stores it locally — rendering never talks to the network;
* prints `<title>`, meta description, canonical, hreflang alternates, robots, Open Graph,
  Twitter Card and JSON-LD on `wp_head` for any URL the hub owns;
* serves `/sitemap.xml` and `/robots.txt` from the local store;
* applies the hub's redirects before the theme renders anything;
* accepts `POST /api/articles` from the hub (spec-1 payload), rendering the hub's Markdown
  through a small built-in CommonMark subset and storing the result in its own table;
* answers `GET /api/seo/health`, `GET /api/seo/pages`, `GET /api/seo/probe` and
  `POST /api/seo/sync` for the hub, all behind the shared Bearer secret.

**No article page is shipped.** The plugin ingests articles and lists their URLs in the
sitemap; rendering an article page is the site's own theme's job. Look up a stored article
with `doitrous_seo_find_article_by_slug(string $lang, string $slug): ?array`, which returns the
same shape the hub sent (`title`, `bodyHtml`, `metaTitle`, `faq`, `schemaJsonld`, `references`,
`og`, `authorName`, …) — a template picks it up from the URL the theme itself dispatched to
`doitrous_seo_article_path($lang, $slug)`.

== Installation ==

1. Upload the plugin to `wp-content/plugins/doitrous-seo` and activate it.
2. Define these three constants in `wp-config.php` (or set them as environment variables) —
   nothing else is read:

   `
   define('SEO_HUB_URL', 'https://hub.example.com');
   define('SEO_HUB_SECRET', '...');
   define('SEO_SITE_SLUG', 'my-site');
   `

   `SEO_SITE_SLUG` only matters before the first successful sync — once a snapshot is stored
   the plugin falls back to the slug the snapshot itself carries.

3. Apache/FPM on most shared hosts strip the incoming `Authorization` header before PHP ever
   sees it as `HTTP_AUTHORIZATION`. If every authenticated route (`/api/seo/*`, `/api/articles`)
   answers 401 even with a correct Bearer secret, add this to the site's `.htaccess` (or the
   vhost) so mod_rewrite passes it through:

   `
   SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
   `

   The plugin already reads `REDIRECT_HTTP_AUTHORIZATION` and `getallheaders()` as fallbacks,
   which covers most hosts without needing the rule above.

== Frequently Asked Questions ==

= Where does an article's URL come from? =

`doitrous_seo_article_path(string $lang, string $slug): string` defaults to
`/$lang/blog/$slug`. Override it per site:

`
add_filter('doitrous_seo_article_path', function ($path, $lang, $slug) {
    return "/$lang/articles/$slug";
}, 10, 3);
`

= Which languages does this site accept articles in? =

`doitrous_seo_supported_languages` filters the array `POST /api/articles` checks a payload's
`lang` against; anything else is reported back in the `skipped` array rather than rejected.
Defaults to the site's own language (`doitrous_seo_site_lang()`):

`
add_filter('doitrous_seo_supported_languages', fn () => ['en', 'ar']);
`

= Why does a request to /sitemap.xml or /api/seo/health never see WordPress's own trailing-
slash redirect? =

WordPress's `redirect_canonical()` runs on `template_redirect` (its default priority is 10) and
would otherwise add a trailing slash to a path like `/en/a` before deciding what to render.
Every route this plugin owns is intercepted earlier than that: `/api/*`, `/sitemap.xml` and
`/robots.txt` are matched and answered (with `exit`) on `init` at priority 0 — long before
`parse_request`/`template_redirect` ever run — and a redirect source path is matched and
answered on `template_redirect` itself, but at priority 1, ahead of `redirect_canonical`'s
priority 10 on the same hook. None of these four kinds of request ever reaches WordPress's own
canonical-redirect logic.

== Changelog ==

= 0.1.0 =
* Initial release: bootstrap, store, resolve/head rendering, routes (B12), redirects, sitemap,
  robots and article ingest (B12b).
