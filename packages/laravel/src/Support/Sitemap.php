<?php

namespace Doitrous\SeoRuntime\Support;

use Doitrous\SeoRuntime\Store\EloquentStore;

/** The port of sitemap.ts and robots.ts. */
class Sitemap
{
    public const PAGE_SIZE = 5000;

    public static function xmlEscape(string $s): string
    {
        return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'], $s);
    }

    /** Omits lastmod for anything that is not at least a 10-char ISO date, mirroring sitemap.ts's NaN guard. */
    private static function day(string $iso): ?string
    {
        return strlen($iso) >= 10 ? substr($iso, 0, 10) : null;
    }

    private static function withDefault(array $alternates): array
    {
        $lang = isset($alternates['en']) ? 'en' : array_key_first($alternates);
        if ($lang !== null) $alternates['x-default'] = $alternates[$lang];

        return $alternates;
    }

    /** sitemapEntries in sitemap.ts: pages first, then one entry per stored article language. */
    public static function entries(array $snapshot, array $articles): array
    {
        $s = $snapshot['settings'];
        if (!($s['indexingEnabled'] ?? true)) return [];
        $out = [];

        $byGroup = [];
        foreach ($snapshot['pages'] as $p) $byGroup[$p['group']][] = $p;

        foreach ($snapshot['pages'] as $p) {
            if (!($p['seo']['index'] ?? true) || !($p['seo']['includeInSitemap'] ?? true)) continue;
            $group = $p['group'] ? ($byGroup[$p['group']] ?? [$p]) : [$p];
            $alternates = [];
            foreach ($group as $g) $alternates[$g['lang']] = Snapshot::absoluteUrl($s, $g['lang'], $g['path']);
            $typeDefaults = $s['pageDefaults'][$p['type']] ?? Snapshot::DEFAULT_PAGE_DEFAULTS;
            $out[] = [
                'loc' => Snapshot::absoluteUrl($s, $p['lang'], $p['path']),
                'lastmod' => self::day($p['updatedAt']),
                'changefreq' => $typeDefaults['changefreq'],
                'priority' => $p['seo']['priority'] ?? $typeDefaults['priority'] ?? 0.5,
                'alternates' => self::withDefault($alternates),
            ];
        }

        // Grouped by external id, not slug: two jobs may reuse a slug in different languages and
        // must not become each other's alternates. One entry per stored version (per locale,
        // 0.2.0), each carrying the full hreflang set of its externalId.
        $byJob = [];
        foreach ($articles as $a) $byJob[$a['externalId']][] = $a;
        $articleDefaults = $s['pageDefaults']['article'] ?? Snapshot::DEFAULT_PAGE_DEFAULTS;
        $urlOf = fn (array $a) => Snapshot::absoluteUrl($s, $a['lang'], Locale::versionPath($a));
        foreach ($byJob as $group) {
            $alternates = Locale::hreflang(self::sourceFirst($group), $urlOf, self::isLegacyGroup($group));
            foreach ($group as $a) {
                $out[] = [
                    'loc' => $urlOf($a),
                    'lastmod' => self::day($a['updatedAt']),
                    'changefreq' => $articleDefaults['changefreq'],
                    'priority' => $articleDefaults['priority'],
                    'alternates' => $alternates,
                ];
            }
        }

        return $out;
    }

    /** Every version under its own language code (what 0.1.x stored): 0.1.6's x-default rule. */
    private static function isLegacyGroup(array $group): bool
    {
        foreach ($group as $a) if (Locale::localeOf($a) !== $a['lang']) return false;

        return true;
    }

    /** The source version first (recovered from the x-default stored at ingest), for x-default. */
    private static function sourceFirst(array $group): array
    {
        $xd = null;
        foreach ($group as $a) if (!empty($a['hreflang']['x-default'])) { $xd = $a['hreflang']['x-default']; break; }
        if ($xd === null) return $group;
        foreach ($group as $i => $a) {
            if (($a['hreflang'][Locale::localeOf($a)] ?? null) === $xd && $i > 0) {
                unset($group[$i]);

                return array_merge([$a], array_values($group));
            }
        }

        return $group;
    }

    public static function urlset(array $entries): string
    {
        $urls = '';
        foreach ($entries as $e) {
            $alts = '';
            foreach ($e['alternates'] as $lang => $href) {
                $alts .= '<xhtml:link rel="alternate" hreflang="' . self::xmlEscape((string) $lang) . '" href="' . self::xmlEscape($href) . '"/>';
            }
            $urls .= '<url><loc>' . self::xmlEscape($e['loc']) . '</loc>'
                . ($e['lastmod'] ? '<lastmod>' . $e['lastmod'] . '</lastmod>' : '')
                . '<changefreq>' . self::xmlEscape($e['changefreq']) . '</changefreq>'
                . '<priority>' . number_format((float) $e['priority'], 1) . '</priority>'
                . $alts . '</url>';
        }

        return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
            . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
            . $urls . '</urlset>';
    }

    /**
     * Phase 1 ships a single /sitemap.xml: above PAGE_SIZE URLs this throws rather than silently
     * truncating or paging. The sitemap index that would split a bigger site across
     * /sitemap-N.xml is deferred to phase 2 (controller ruling for this task).
     */
    public static function xml(EloquentStore $store): string
    {
        $snapshot = $store->getSnapshot();
        if (!$snapshot) return self::urlset([]);
        $entries = self::entries($snapshot, $store->listArticles());
        if (count($entries) > self::PAGE_SIZE) {
            throw new \RuntimeException(sprintf(
                'sitemap has %d URLs, over the %d-URL per-file limit; '
                . 'the sitemap index that would split this across multiple files is deferred to phase 2',
                count($entries),
                self::PAGE_SIZE,
            ));
        }

        return self::urlset($entries);
    }

    /** No CR/LF: a UA name is one robots.txt line and must never be able to inject a second one. */
    private static function safeUa(string $ua): string
    {
        return str_replace(["\r", "\n"], '', trim($ua));
    }

    public static function robots(?array $snapshot): string
    {
        if (!$snapshot) return "User-agent: *\nAllow: /\n";
        $s = $snapshot['settings'];
        if (!($s['indexingEnabled'] ?? true)) return "User-agent: *\nDisallow: /\n";
        $urls = $s['baseUrls'] ?? [];
        $base = rtrim(reset($urls) ?: '', '/');
        $lines = array_merge(['User-agent: *', 'Allow: /'], array_filter($s['robotsExtra'] ?? []));
        // v2: per-UA blocks for named crawlers (GPTBot, ClaudeBot, …).
        foreach ($s['crawlerPolicy']['allow'] ?? [] as $ua) {
            $u = self::safeUa($ua);
            if ($u !== '') $lines = array_merge($lines, ['', "User-agent: $u", 'Allow: /']);
        }
        foreach ($s['crawlerPolicy']['disallow'] ?? [] as $ua) {
            $u = self::safeUa($ua);
            if ($u !== '') $lines = array_merge($lines, ['', "User-agent: $u", 'Disallow: /']);
        }
        if ($base !== '') $lines = array_merge($lines, ['', "Sitemap: $base/sitemap.xml"]);

        return implode("\n", $lines) . "\n";
    }
}
