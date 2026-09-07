<?php

if (!defined('ABSPATH')) exit;

const DOITROUS_SEO_EMPTY_SETTINGS = [
    'baseUrls' => [], 'indexingEnabled' => true, 'brandSuffix' => '', 'defaultOgImage' => '',
    'organization' => ['name' => '', 'logo' => '', 'sameAs' => [], 'phone' => '', 'email' => '', 'address' => '', 'hours' => '', 'type' => 'Organization'],
    'robotsExtra' => [], 'pageDefaults' => [], 'reservedPrefixes' => ['/api', '/admin'], 'twitterHandle' => '',
];

const DOITROUS_SEO_PAGE_DEFAULTS = ['titleTemplate' => '%s', 'schemaType' => 'WebPage', 'changefreq' => 'monthly', 'priority' => 0.5];

const DOITROUS_SEO_EMPTY_META = ['title' => '', 'description' => '', 'image' => ''];

function doitrous_seo_normalize_path(string $path): string {
    $bare = trim(explode('?', explode('#', $path, 2)[0], 2)[0]);
    $withSlash = str_starts_with($bare, '/') ? $bare : "/$bare";

    return strlen($withSlash) > 1 ? rtrim($withSlash, '/') : '/';
}

function doitrous_seo_absolute_url(array $settings, string $lang, string $path): string {
    $urls = $settings['baseUrls'] ?? [];
    $origin = rtrim($urls[$lang] ?? (reset($urls) ?: ''), '/');

    return $origin === '' ? $path : $origin . (str_starts_with($path, '/') ? '' : '/') . $path;
}

function doitrous_seo_is_schema_org(mixed $entry): bool {
    return is_array($entry)
        && ($entry['@context'] ?? null) === 'https://schema.org'
        && is_string($entry['@type'] ?? null);
}

function doitrous_seo_safe_destination(mixed $dest): ?string {
    $d = trim((string) $dest);
    // "/\host" is scheme-relative too: every browser normalizes a leading /\ exactly like //
    // (new URL('/\\evil.com', base) resolves to https://evil.com/), so both are rejected.
    if ($d === '' || preg_match('#^/[/\\\\]#', $d) === 1) return null;
    if (str_starts_with($d, '/')) return $d;

    return preg_match('#^https://\S+$#i', $d) ? $d : null;
}

/**
 * `str_replace('%s', ...)` would replace every `%s` in the template; JS's `.replace(string, fn)`
 * — what resolve.ts actually calls — replaces only the first match. A titleTemplate carrying two
 * `%s` tokens would then diverge from core-js, so the substitution stops at the first occurrence
 * here too.
 */
function doitrous_seo_replace_first(string $search, string $replace, string $subject): string {
    $pos = strpos($subject, $search);
    if ($pos === false) return $subject;

    return substr($subject, 0, $pos) . $replace . substr($subject, $pos + strlen($search));
}

/** Deep enough that the sanitiser cannot dereference a missing key: a bad body is a 400. */
function doitrous_seo_is_snapshot(mixed $body): bool {
    if (!is_array($body)) return false;
    if (!is_int($body['version'] ?? null) || !is_string($body['siteSlug'] ?? null)) return false;
    if (!is_array($body['settings'] ?? null) || !is_array($body['pages'] ?? null) || !is_array($body['redirects'] ?? null)) return false;
    foreach ($body['pages'] as $p) {
        if (!is_array($p) || !is_string($p['path'] ?? null) || !is_string($p['lang'] ?? null) || !is_array($p['seo'] ?? null)) return false;
    }
    foreach ($body['redirects'] as $r) {
        if (!is_array($r) || !is_string($r['source'] ?? null) || !is_string($r['destination'] ?? null)) return false;
    }

    return true;
}

function doitrous_seo_sanitize(array $s): array {
    $s['redirects'] = array_values(array_filter($s['redirects'], fn ($r) => doitrous_seo_safe_destination($r['destination']) !== null));
    $s['pages'] = array_map(function (array $p) {
        $p['seo']['structuredData'] = array_values(array_filter($p['seo']['structuredData'] ?? [], 'doitrous_seo_is_schema_org'));

        return $p;
    }, $s['pages']);

    return $s;
}

/**
 * On a cold store (nothing synced yet) there is no stored siteSlug to check against, so the
 * SEO_SITE_SLUG constant/env var stands in for it when set — the boot state is exactly when a
 * mistyped hub slug would otherwise seed the wrong site's pages with no prior snapshot to catch it.
 */
function doitrous_seo_configured_slug(): string {
    return (string) (defined('SEO_SITE_SLUG') ? SEO_SITE_SLUG : getenv('SEO_SITE_SLUG'));
}

function doitrous_seo_apply(mixed $incoming): array {
    if (!doitrous_seo_is_snapshot($incoming)) return ['status' => 'invalid', 'version' => 0];
    $current = doitrous_seo_get_snapshot();
    $expectedSlug = ($current['siteSlug'] ?? '') ?: doitrous_seo_configured_slug();
    if ($expectedSlug !== '' && $incoming['siteSlug'] !== $expectedSlug) {
        return ['status' => 'invalid', 'version' => $current['version'] ?? 0];
    }
    if ($current && $incoming['version'] < $current['version']) {
        return ['status' => 'stale', 'version' => $current['version']];
    }
    doitrous_seo_put_snapshot(doitrous_seo_sanitize($incoming));

    return ['status' => 'applied', 'version' => $incoming['version']];
}

function doitrous_seo_organization_jsonld(array $settings): ?array {
    $o = $settings['organization'] ?? [];
    if (($o['name'] ?? '') === '') return null;
    $urls = $settings['baseUrls'] ?? [];
    $out = ['@context' => 'https://schema.org', '@type' => $o['type'] ?: 'Organization', 'name' => $o['name']];
    foreach ([['url', reset($urls) ?: ''], ['logo', $o['logo'] ?? ''], ['telephone', $o['phone'] ?? ''],
              ['email', $o['email'] ?? ''], ['address', $o['address'] ?? ''], ['openingHours', $o['hours'] ?? '']] as [$k, $v]) {
        if ($v !== '') $out[$k] = $v;
    }
    if (!empty($o['sameAs'])) $out['sameAs'] = $o['sameAs'];

    return $out;
}

/** composeSeo in resolve.ts, field for field. */
function doitrous_seo_compose(?array $page, array $settings, string $path, string $lang, array $group = []): array {
    $s = $settings ?: DOITROUS_SEO_EMPTY_SETTINGS;
    $typeDefaults = ($page ? ($s['pageDefaults'][$page['type']] ?? null) : null) ?: DOITROUS_SEO_PAGE_DEFAULTS;
    $seo = $page['seo'] ?? null;

    $templated = $page ? doitrous_seo_replace_first('%s', $page['title'], $typeDefaults['titleTemplate']) : ($s['organization']['name'] ?? '');
    $rawTitle = trim($seo['seoTitle'] ?? '') ?: ($templated ?: '');
    $suffix = $s['brandSuffix'] ?? '';
    $title = ($rawTitle !== '' && $suffix !== '' && !str_ends_with($rawTitle, $suffix)) ? $rawTitle . $suffix : $rawTitle;

    $description = $seo['metaDescription'] ?? '';
    $canonical = trim($seo['canonical'] ?? '') ?: doitrous_seo_absolute_url($s, $lang, $path);

    $alternates = [];
    foreach ($group as $g) $alternates[$g['lang']] = doitrous_seo_absolute_url($s, $g['lang'], $g['path']);
    if (!$group && $page) $alternates[$page['lang']] = $canonical;
    $defaultLang = isset($alternates['en']) ? 'en' : array_key_first($alternates);
    if ($defaultLang !== null) $alternates['x-default'] = $alternates[$defaultLang];

    $pageOg = $seo['og'] ?? DOITROUS_SEO_EMPTY_META;
    $og = [
        'title' => $pageOg['title'] ?: $title,
        'description' => $pageOg['description'] ?: $description,
        'image' => $pageOg['image'] ?: ($s['defaultOgImage'] ?? ''),
    ];
    $pageTw = $seo['twitter'] ?? DOITROUS_SEO_EMPTY_META;
    $twitter = [
        'title' => $pageTw['title'] ?: $og['title'],
        'description' => $pageTw['description'] ?: $og['description'],
        'image' => $pageTw['image'] ?: $og['image'],
    ];

    $override = array_values(array_filter($seo['structuredData'] ?? [], 'doitrous_seo_is_schema_org'));
    $generated = ($page && !$override) ? [array_filter([
        '@context' => 'https://schema.org',
        '@type' => ($seo['schemaType'] ?? '') ?: $typeDefaults['schemaType'],
        '@id' => $canonical . '#page', 'url' => $canonical,
        'name' => $rawTitle ?: $page['title'],
        'description' => $description ?: null,
        'inLanguage' => $lang, 'dateModified' => $page['updatedAt'],
    ], fn ($v) => $v !== null)] : $override;
    $org = doitrous_seo_organization_jsonld($s);

    return [
        'title' => $title, 'description' => $description, 'canonical' => $canonical,
        'robots' => [
            'index' => ($seo['index'] ?? true) && ($s['indexingEnabled'] ?? true),
            'follow' => $seo['follow'] ?? true,
        ],
        'alternates' => $alternates, 'og' => $og, 'twitter' => $twitter,
        'jsonld' => $org ? array_merge($generated, [$org]) : $generated,
    ];
}

/**
 * How many times a store read has thrown since this request began. Reported by the health ping
 * instead of a hard-coded 0. `$increment` is an internal detail of this one-function counter
 * pattern (a plugin file, not a class, so there is no static property to hold it) — callers only
 * ever read it with no argument.
 */
function doitrous_seo_store_failures(int $increment = 0): int {
    static $failures = 0;
    if ($increment) $failures += $increment;

    return $failures;
}

/**
 * Two per-key reads, never a whole-store scan on the render path. Never throws: a corrupt
 * `doitrous_seo_snapshot` option degrades to the empty resolved shape instead of fataling inside
 * `wp_head`, matching the try/catch every other port's resolve() already has.
 */
function doitrous_seo_resolve(string $path, string $lang): array {
    $p = doitrous_seo_normalize_path($path);
    try {
        $settings = doitrous_seo_get_settings() ?: DOITROUS_SEO_EMPTY_SETTINGS;
        $page = doitrous_seo_get_page($p, $lang);
        if (!$page) return doitrous_seo_compose(null, $settings, $p, $lang);
        $group = $page['group'] ? doitrous_seo_list_group($page['group']) : [];

        return doitrous_seo_compose($page, $settings, $p, $lang, $group ?: [$page]);
    } catch (\Throwable $e) {
        doitrous_seo_store_failures(1);

        return doitrous_seo_compose(null, DOITROUS_SEO_EMPTY_SETTINGS, $p, $lang);
    }
}
