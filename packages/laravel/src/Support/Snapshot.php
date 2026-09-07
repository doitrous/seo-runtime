<?php

namespace Doitrous\SeoRuntime\Support;

use Doitrous\SeoRuntime\Store\EloquentStore;

/**
 * The PHP port of core-js's resolve.ts, redirects.ts, sync.ts and health.ts. Every method here
 * has a named counterpart in the JS; when the two disagree, the conformance suite (and the
 * TypeScript, as shipped) is the arbiter.
 */
class Snapshot
{
    public const EMPTY_SETTINGS = [
        'baseUrls' => [], 'indexingEnabled' => true, 'brandSuffix' => '', 'defaultOgImage' => '',
        'organization' => ['name' => '', 'logo' => '', 'sameAs' => [], 'phone' => '', 'email' => '', 'address' => '', 'hours' => '', 'type' => 'Organization'],
        'robotsExtra' => [], 'pageDefaults' => [], 'reservedPrefixes' => ['/api', '/admin'], 'twitterHandle' => '',
    ];

    public const DEFAULT_PAGE_DEFAULTS = ['titleTemplate' => '%s', 'schemaType' => 'WebPage', 'changefreq' => 'monthly', 'priority' => 0.5];

    public const EMPTY_META = ['title' => '', 'description' => '', 'image' => ''];

    /** How many times a store read has thrown since boot. Reported by the health ping. */
    private static int $failures = 0;

    public static function storeFailures(): int
    {
        return self::$failures;
    }

    /** normalizePath in types.ts: no query, no hash, leading slash, no trailing slash. */
    public static function normalizePath(string $path): string
    {
        $bare = trim(explode('?', explode('#', $path, 2)[0], 2)[0]);
        $withSlash = str_starts_with($bare, '/') ? $bare : "/$bare";

        return strlen($withSlash) > 1 ? rtrim($withSlash, '/') : '/';
    }

    public static function absoluteUrl(array $settings, string $lang, string $path): string
    {
        $urls = $settings['baseUrls'] ?? [];
        $origin = rtrim($urls[$lang] ?? (reset($urls) ?: ''), '/');

        return $origin === '' ? $path : $origin . (str_starts_with($path, '/') ? '' : '/') . $path;
    }

    public static function isSchemaOrg(mixed $entry): bool
    {
        return is_array($entry)
            && ($entry['@context'] ?? null) === 'https://schema.org'
            && is_string($entry['@type'] ?? null);
    }

    /** safeDestination in redirects.ts: site-relative or https, nothing else. */
    public static function safeDestination(mixed $dest): ?string
    {
        $d = trim((string) $dest);
        if ($d === '' || str_starts_with($d, '//')) return null;
        if (str_starts_with($d, '/')) return $d;

        return preg_match('#^https://\S+$#i', $d) ? $d : null;
    }

    public static function isReserved(string $path, array $reserved): bool
    {
        $p = self::normalizePath($path);
        foreach ($reserved as $r) {
            $prefix = self::normalizePath((string) $r);
            if ($p === $prefix || str_starts_with($p, $prefix . '/')) return true;
        }

        return false;
    }

    /**
     * Validated deep enough that sanitize() can dereference what it touches: a malformed page is
     * a 400, never a 500 from inside the sanitizer.
     */
    public static function isSnapshot(mixed $body): bool
    {
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

    /** Drops everything the runtime refuses to render, once, at sync time. */
    public static function sanitize(array $s): array
    {
        $s['redirects'] = array_values(array_filter(
            $s['redirects'],
            fn ($r) => self::safeDestination($r['destination']) !== null,
        ));
        $s['pages'] = array_map(function (array $p) {
            $p['seo']['structuredData'] = array_values(array_filter(
                $p['seo']['structuredData'] ?? [],
                fn ($e) => self::isSchemaOrg($e),
            ));

            return $p;
        }, $s['pages']);

        return $s;
    }

    /**
     * applySnapshot in sync.ts: a version below the stored one is ignored, and a snapshot
     * addressed to a different site is refused outright — a runtime must never render another
     * site's pages because a slug was mistyped in the hub. An equal version re-applies.
     */
    public static function apply(EloquentStore $store, mixed $incoming): array
    {
        if (!self::isSnapshot($incoming)) return ['status' => 'invalid', 'version' => 0];
        $current = $store->getSnapshot();
        if ($current && $current['siteSlug'] && $incoming['siteSlug'] !== $current['siteSlug']) {
            return ['status' => 'invalid', 'version' => $current['version']];
        }
        if ($current && $incoming['version'] < $current['version']) {
            return ['status' => 'stale', 'version' => $current['version']];
        }
        $store->putSnapshot(self::sanitize($incoming));

        return ['status' => 'applied', 'version' => $incoming['version']];
    }

    public static function organizationJsonLd(array $settings): ?array
    {
        $o = $settings['organization'] ?? [];
        if (($o['name'] ?? '') === '') return null;
        $urls = $settings['baseUrls'] ?? [];
        $url = reset($urls) ?: '';
        $out = ['@context' => 'https://schema.org', '@type' => $o['type'] ?: 'Organization', 'name' => $o['name']];
        foreach ([['url', $url], ['logo', $o['logo'] ?? ''], ['telephone', $o['phone'] ?? ''], ['email', $o['email'] ?? ''], ['address', $o['address'] ?? ''], ['openingHours', $o['hours'] ?? '']] as [$key, $value]) {
            if ($value !== '') $out[$key] = $value;
        }
        if (!empty($o['sameAs'])) $out['sameAs'] = $o['sameAs'];

        return $out;
    }

    /**
     * First occurrence only, literally: mirrors `titleTemplate.replace('%s', () => page.title)`
     * in resolve.ts, whose callback form exists so a title containing `$&` is inserted literally
     * rather than being read as a regex backreference. `str_replace` would touch every `%s` in
     * the template (there is only ever one in practice, but the port should not rely on that).
     */
    private static function replaceFirst(string $search, string $replace, string $subject): string
    {
        $pos = strpos($subject, $search);

        return $pos === false ? $subject : substr_replace($subject, $replace, $pos, strlen($search));
    }

    /** composeSeo in resolve.ts, field for field. */
    public static function compose(?array $page, array $settings, string $path, string $lang, array $group = []): array
    {
        $s = $settings ?: self::EMPTY_SETTINGS;
        $typeDefaults = ($page ? ($s['pageDefaults'][$page['type']] ?? null) : null) ?: self::DEFAULT_PAGE_DEFAULTS;
        $seo = $page['seo'] ?? null;

        $templated = $page
            ? self::replaceFirst('%s', $page['title'], $typeDefaults['titleTemplate'])
            : ($s['organization']['name'] ?? '');
        $rawTitle = trim($seo['seoTitle'] ?? '') ?: ($templated ?: '');
        $suffix = $s['brandSuffix'] ?? '';
        $title = ($rawTitle !== '' && $suffix !== '' && !str_ends_with($rawTitle, $suffix)) ? $rawTitle . $suffix : $rawTitle;

        $description = $seo['metaDescription'] ?? '';
        $canonical = trim($seo['canonical'] ?? '') ?: self::absoluteUrl($s, $lang, $path);

        $alternates = [];
        foreach ($group as $g) $alternates[$g['lang']] = self::absoluteUrl($s, $g['lang'], $g['path']);
        if (!$group && $page) $alternates[$page['lang']] = $canonical;
        $defaultLang = isset($alternates['en']) ? 'en' : (array_key_first($alternates) ?? null);
        if ($defaultLang !== null) $alternates['x-default'] = $alternates[$defaultLang];

        $pageOg = $seo['og'] ?? self::EMPTY_META;
        $og = [
            'title' => $pageOg['title'] ?: $title,
            'description' => $pageOg['description'] ?: $description,
            'image' => $pageOg['image'] ?: ($s['defaultOgImage'] ?? ''),
        ];
        $pageTw = $seo['twitter'] ?? self::EMPTY_META;
        $twitter = [
            'title' => $pageTw['title'] ?: $og['title'],
            'description' => $pageTw['description'] ?: $og['description'],
            'image' => $pageTw['image'] ?: $og['image'],
        ];

        $override = array_values(array_filter($seo['structuredData'] ?? [], fn ($e) => self::isSchemaOrg($e)));
        $generated = ($page && !$override) ? [array_filter([
            '@context' => 'https://schema.org',
            '@type' => ($seo['schemaType'] ?? '') ?: $typeDefaults['schemaType'],
            '@id' => $canonical . '#page',
            'url' => $canonical,
            'name' => $rawTitle ?: $page['title'],
            'description' => $description ?: null,
            'inLanguage' => $lang,
            'dateModified' => $page['updatedAt'],
        ], fn ($v) => $v !== null)] : $override;
        $org = self::organizationJsonLd($s);

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

    public static function emptyResolved(string $path): array
    {
        return self::compose(null, self::EMPTY_SETTINGS, $path, 'en');
    }

    /** resolveSeo in resolve.ts: two per-key reads, never a whole-store read. */
    public static function resolve(EloquentStore $store, string $path, string $lang): array
    {
        $p = self::normalizePath($path);
        try {
            $settings = $store->getSettings() ?: self::EMPTY_SETTINGS;
            $page = $store->getPage($p, $lang);
            if (!$page) return self::compose(null, $settings, $p, $lang);
            $group = $page['group'] ? $store->listGroup($page['group']) : [];

            return self::compose($page, $settings, $p, $lang, $group ?: [$page]);
        } catch (\Throwable $e) {
            self::$failures++;

            return self::compose(null, self::EMPTY_SETTINGS, $p, $lang);
        }
    }

    /** redirectFor in redirects.ts, including the hit counter. */
    public static function matchRedirect(string $url, EloquentStore $store, array $reserved): ?array
    {
        try {
            $path = self::normalizePath(str_starts_with($url, 'http') ? (parse_url($url, PHP_URL_PATH) ?: '/') : $url);
            if (self::isReserved($path, $reserved)) return null;
            $row = $store->getRedirect($path);
            if (!$row) return null;
            $destination = self::safeDestination($row['destination']);
            if ($destination === null) return null;
            $store->incrementHit($path);

            return ['destination' => $destination, 'status' => in_array($row['type'], [301, 302, 307, 308], true) ? $row['type'] : 301];
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** GET /api/seo/pages: the site's provider plus the runtime's own article pages. */
    public static function providerPages(EloquentStore $store): array
    {
        $provider = config('seo-runtime.pages');
        $pages = is_callable($provider) ? (array) $provider() : [];
        $articlePath = Articles::articlePath();
        foreach ($store->listArticles() as $a) {
            $pages[] = [
                'key' => 'article:' . $a['externalId'], 'type' => 'article', 'lang' => $a['lang'],
                'path' => $articlePath($a['lang'], $a['slug']), 'title' => $a['title'], 'updatedAt' => $a['updatedAt'],
            ];
        }

        return $pages;
    }

    /** healthPayload in health.ts. Read-only: the counters are drained after the hub's 2xx. */
    public static function health(EloquentStore $store, string $version, string $slug): array
    {
        $snapshot = $store->getSnapshot();
        $hits = $store->peekHits();
        usort($hits, fn ($a, $b) => $b['hits'] <=> $a['hits']);

        return [
            'version' => $version,
            'siteSlug' => $slug ?: ($snapshot['siteSlug'] ?? ''),
            'lastSyncAt' => $store->lastSyncAt(),
            'snapshotVersion' => $snapshot['version'] ?? 0,
            'counts' => [
                'pages' => count($snapshot['pages'] ?? []),
                'redirects' => count($snapshot['redirects'] ?? []),
                'articles' => count($store->listArticles()),
                'storeFailures' => self::storeFailures(),
            ],
            'redirectHits' => array_slice($hits, 0, 1000),
        ];
    }

    /**
     * jsonLdBody/jsonLdScript in markdown.ts: `<` is escaped as the six-character sequence
     * backslash-u-0-0-3-c so a `</script>` inside a string value can never close the tag early.
     * The replacement MUST be the single-quoted literal '<' (six characters) — a double-quoted
     * "<" is a PHP Unicode escape and collapses back to a literal "<", which is a no-op and
     * reopens the XSS hole this function exists to close.
     *
     * JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE: JS's JSON.stringify never escapes '/'
     * and emits non-ASCII characters as-is, never as \uXXXX. Without these flags PHP's
     * json_encode diverges byte for byte -- a stray backslash-slash breaks an exact-string match
     * against the JS output (the conformance suite's own JSON-LD escape test is one), and an
     * Arabic title would come out unicode-escaped instead of literal.
     */
    public static function jsonLdBody(array $entry): string
    {
        return str_replace('<', '\u003c', json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    public static function jsonLdScript(array $entries): string
    {
        $out = '';
        foreach ($entries as $e) {
            $out .= '<script type="application/ld+json">' . self::jsonLdBody($e) . '</script>';
        }

        return $out;
    }
}
