# seo-runtime

Per-stack SEO runtimes for the [seo-hub](https://github.com/omary98/seohub) platform. The hub decides;
these packages render. See `packages/CONTRACT.md` for the behaviour every package implements and
`packages/conformance/` for the suite that proves it.

| Package | Stack | Install |
|---|---|---|
| `@doitrous/seo-runtime-core` | any JS | `npm i @doitrous/seo-runtime-core` |
| `@doitrous/seo-runtime-next` | Next.js 14+ app router | `npm i @doitrous/seo-runtime-next` |
| `@doitrous/seo-runtime-express` | Express 4/5 | `npm i @doitrous/seo-runtime-express` |
| `doitrous/seo-runtime-laravel` | Laravel 10+ | `composer require doitrous/seo-runtime-laravel` |
| `doitrous-seo` | WordPress 6+ | plugin zip from the GitHub releases |

Configuration is `SEO_HUB_URL`, `SEO_HUB_SECRET` and the optional `SEO_SITE_SLUG`. Nothing else.
