<?php

namespace Doitrous\SeoRuntime\Support;

/**
 * The port of core-js's locale.ts — per-country pages (0.2.0, hub contract 1.20.0).
 *
 * A *lang* is the plain language a site already serves (`ar`); a *locale* is a language plus a
 * region (`ar-AE`). The **lead** version of a language is the first payload item of that
 * language; it keeps the language's existing URL (`article_path`). Every other version of that
 * language is served under a lowercase locale prefix (`/ar-ae/blog/x`).
 */
class Locale
{
    private const LOCALE_RE = '/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})+$/';
    private const LANG_RE = '/^[A-Za-z]{2,3}$/';

    public static function isLocaleCode(string $s): bool
    {
        return preg_match(self::LOCALE_RE, $s) === 1;
    }

    public static function isLangOrLocale(string $s): bool
    {
        return preg_match(self::LANG_RE, $s) === 1 || self::isLocaleCode($s);
    }

    /** `ar-ae` / `ar_AE` → `ar-AE`; `zh-hant-tw` → `zh-Hant-TW`; a plain lang is lowercased. */
    public static function canonical(string $s): string
    {
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

    /** `ar-AE` → `ar`. */
    public static function langOf(string $locale): string
    {
        return explode('-', self::canonical($locale))[0] ?? '';
    }

    /** A stored version's locale: rows written before 0.2.0 have none, their locale is their lang. */
    public static function localeOf(array $a): string
    {
        $l = $a['locale'] ?? null;

        return is_string($l) && $l !== '' ? self::canonical($l) : $a['lang'];
    }

    /** Rows written before 0.2.0 have no lead flag: each was the only version of its language. */
    public static function isLead(array $a): bool
    {
        return ($a['lead'] ?? true) !== false;
    }

    /**
     * localizePath in locale.ts: the first path segment equal to the language (never the last,
     * the slug) becomes the lowercase locale; with none, `/<locale>` is prepended. Path or URL.
     */
    public static function localizePath(string $pathOrUrl, string $lang, string $locale): string
    {
        $loc = strtolower(self::canonical($locale));
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
        $out = '/' . $loc . (str_starts_with($path, '/') ? '' : '/') . ($path === '/' ? '' : $path);

        return $origin . $out . $suffix;
    }

    /**
     * Where a non-lead version is served: config `seo-runtime.article_locale_path`
     * (fn (string $locale, string $slug): string), else `localizePath` over `article_path`.
     */
    public static function articleLocalePath(): callable
    {
        $configured = config('seo-runtime.article_locale_path');
        if (is_callable($configured)) return $configured;
        $articlePath = Articles::articlePath();

        return function (string $locale, string $slug) use ($articlePath) {
            $lang = self::langOf($locale);

            return self::localizePath($articlePath($lang, $slug), $lang, $locale);
        };
    }

    /** The site-relative path of one stored version (articleVersionPath in locale.ts). */
    public static function versionPath(array $a): string
    {
        if (self::isLead($a)) return (Articles::articlePath())($a['lang'], $a['slug']);

        return (self::articleLocalePath())(self::localeOf($a), $a['slug']);
    }

    /**
     * articleHreflang in locale.ts: every locale → its URL, each language → its lead's URL,
     * x-default → the first version (the source). `$legacy` (a payload without `locale`) keeps
     * 0.1.6's x-default: `en` when present, else the first language.
     */
    public static function hreflang(array $versions, callable $urlOf, bool $legacy = false): array
    {
        $out = [];
        foreach ($versions as $v) $out[self::localeOf($v)] = $urlOf($v);
        foreach ($versions as $v) if (self::isLead($v)) $out[$v['lang']] = $urlOf($v);
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
     * parseLocalePrefix in locale.ts: `/ar-ae/blog/x` → ['segment' => 'ar-ae', 'lang' => 'ar',
     * 'locale' => 'ar-AE', 'rest' => '/blog/x']; `/ar/blog/x` → locale null. Null when the first
     * segment is neither, or (with `$supported`) not one of the site's languages.
     */
    public static function parsePrefix(string $pathname, ?array $supported = null): ?array
    {
        $path = preg_split('/[?#]/', $pathname)[0] ?? '';
        if (!preg_match('#^/([^/]+)(/.*)?$#', $path, $m)) return null;
        $segment = $m[1];
        if (!self::isLangOrLocale($segment)) return null;
        $locale = self::isLocaleCode($segment) ? self::canonical($segment) : null;
        $lang = $locale ? self::langOf($locale) : strtolower($segment);
        if ($supported !== null) {
            $ok = false;
            foreach ($supported as $s) {
                if (strtolower($s) === $lang || strtolower($s) === strtolower($segment)) $ok = true;
            }
            if (!$ok) return null;
        }

        return ['segment' => $segment, 'lang' => $lang, 'locale' => $locale, 'rest' => ($m[2] ?? '') ?: '/'];
    }
}
