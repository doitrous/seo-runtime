<?php

if (!defined('ABSPATH')) exit;

/**
 * Per-country pages (0.2.0, hub contract 1.20.0) — the port of core-js's locale.ts.
 *
 * A *lang* is the plain language the site already serves (`ar`); a *locale* is a language plus a
 * region (`ar-AE`). The **lead** version of a language is the first payload item of that
 * language; it keeps the language's existing URL (`doitrous_seo_article_path`). Every other
 * version is served under a lowercase locale prefix (`/ar-ae/blog/x`), see
 * `doitrous_seo_article_locale_path` (filterable).
 */

function doitrous_seo_is_locale_code(string $s): bool {
    return preg_match('/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})+$/', $s) === 1;
}

function doitrous_seo_is_lang_or_locale(string $s): bool {
    return preg_match('/^[A-Za-z]{2,3}$/', $s) === 1 || doitrous_seo_is_locale_code($s);
}

/** `ar-ae` / `ar_AE` → `ar-AE`; `zh-hant-tw` → `zh-Hant-TW`; a plain lang is lowercased. */
function doitrous_seo_canonical_locale(string $s): string {
    $parts = array_values(array_filter(preg_split('/[-_]/', trim($s)) ?: [], fn ($p) => $p !== ''));
    $out = [];
    foreach ($parts as $i => $p) {
        if ($i === 0) $out[] = strtolower($p);
        elseif (strlen($p) === 2 || preg_match('/^\d{3}$/', $p)) $out[] = strtoupper($p);
        elseif (strlen($p) === 4) $out[] = ucfirst(strtolower($p));
        else $out[] = strtolower($p);
    }

    return implode('-', $out);
}

function doitrous_seo_lang_of_locale(string $locale): string {
    return explode('-', doitrous_seo_canonical_locale($locale))[0] ?? '';
}

/** A stored version's locale: rows written before 0.2.0 have none, their locale is their lang. */
function doitrous_seo_locale_of(array $a): string {
    $l = $a['locale'] ?? null;

    return is_string($l) && $l !== '' ? doitrous_seo_canonical_locale($l) : $a['lang'];
}

/** Rows written before 0.2.0 have no lead flag: each was the only version of its language. */
function doitrous_seo_is_lead(array $a): bool {
    return ($a['lead'] ?? true) !== false;
}

/**
 * The first path segment equal to the language (never the last, the slug) becomes the lowercase
 * locale; with none, `/<locale>` is prepended. Works on a path or an absolute URL.
 */
function doitrous_seo_localize_path(string $pathOrUrl, string $lang, string $locale): string {
    $loc = strtolower(doitrous_seo_canonical_locale($locale));
    $l = strtolower($lang);
    $origin = '';
    $rest = $pathOrUrl;
    if (preg_match('#^([a-z][a-z0-9+.-]*://[^/?\#]*)(.*)$#i', $rest, $m)) { $origin = $m[1]; $rest = $m[2]; }
    $cut = strcspn($rest, '?#');
    $suffix = substr($rest, $cut);
    $path = substr($rest, 0, $cut) ?: '/';
    $segs = explode('/', $path);
    $last = count($segs) - 1;
    while ($last > 0 && $segs[$last] === '') $last--;
    for ($i = 1; $i < $last; $i++) {
        if (strtolower($segs[$i]) === $l) {
            $segs[$i] = $loc;

            return $origin . implode('/', $segs) . $suffix;
        }
    }

    return $origin . '/' . $loc . (str_starts_with($path, '/') ? '' : '/') . ($path === '/' ? '' : $path) . $suffix;
}

/**
 * Where a non-lead version is served. Filterable:
 *   add_filter('doitrous_seo_article_locale_path', fn ($p, $locale, $slug) => "/$locale/articles/$slug", 10, 3);
 */
function doitrous_seo_article_locale_path(string $locale, string $slug): string {
    $lang = doitrous_seo_lang_of_locale($locale);
    $default = doitrous_seo_localize_path(doitrous_seo_article_path($lang, $slug), $lang, $locale);

    return (string) apply_filters('doitrous_seo_article_locale_path', $default, $locale, $slug);
}

/** The site-relative path of one stored version: the lead at its language URL, others by locale. */
function doitrous_seo_article_version_path(array $a): string {
    return doitrous_seo_is_lead($a)
        ? doitrous_seo_article_path($a['lang'], $a['slug'])
        : doitrous_seo_article_locale_path(doitrous_seo_locale_of($a), $a['slug']);
}

/**
 * Every locale → its URL, each language → its lead's URL, x-default → the first version (the
 * source). `$legacy` (a payload without `locale`) keeps 0.1.6's x-default: `en`, else the first.
 */
function doitrous_seo_article_hreflang(array $versions, callable $urlOf, bool $legacy = false): array {
    $out = [];
    foreach ($versions as $v) $out[doitrous_seo_locale_of($v)] = $urlOf($v);
    foreach ($versions as $v) if (doitrous_seo_is_lead($v)) $out[$v['lang']] = $urlOf($v);
    if (!$versions) return $out;
    if ($legacy) {
        $lang = isset($out['en']) ? 'en' : array_key_first($out);
        if ($lang !== null) $out['x-default'] = $out[$lang];
    } else {
        $out['x-default'] = $urlOf($versions[0]);
    }

    return $out;
}

/**
 * `/ar-ae/blog/x` → ['segment' => 'ar-ae', 'lang' => 'ar', 'locale' => 'ar-AE', 'rest' => '/blog/x'];
 * `/ar/blog/x` → locale null. Null when the first segment is neither, or (with `$supported`) not
 * one of the site's languages.
 */
function doitrous_seo_parse_locale_prefix(string $pathname, ?array $supported = null): ?array {
    $path = preg_split('/[?#]/', $pathname)[0] ?? '';
    if (!preg_match('#^/([^/]+)(/.*)?$#', $path, $m)) return null;
    $segment = $m[1];
    if (!doitrous_seo_is_lang_or_locale($segment)) return null;
    $locale = doitrous_seo_is_locale_code($segment) ? doitrous_seo_canonical_locale($segment) : null;
    $lang = $locale ? doitrous_seo_lang_of_locale($locale) : strtolower($segment);
    if ($supported !== null) {
        $ok = false;
        foreach ($supported as $s) if (strtolower($s) === $lang || strtolower($s) === strtolower($segment)) $ok = true;
        if (!$ok) return null;
    }

    return ['segment' => $segment, 'lang' => $lang, 'locale' => $locale, 'rest' => ($m[2] ?? '') ?: '/'];
}

/**
 * The theme's article lookup. `$langOrLocale` is the first segment of the article URL (`ar` →
 * that language's lead, `ar-ae` → the ar-AE version). Null for an unknown slug, and for a locale
 * that names its language's lead (served at the language URL only) — answer 404.
 */
function doitrous_seo_get_article(string $langOrLocale, string $slug): ?array {
    $key = trim($langOrLocale);
    if ($key === '' || $slug === '') return null;
    $a = doitrous_seo_find_article_by_slug($key, $slug);
    if (!$a) return null;
    if (doitrous_seo_is_lead($a)) return strtolower($a['lang']) === strtolower($key) ? $a : null;

    return doitrous_seo_locale_of($a) === doitrous_seo_canonical_locale($key) ? $a : null;
}
