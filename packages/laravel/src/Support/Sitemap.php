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

    private static function day(string $iso): ?string
    {
        return $iso === '' ? null : substr($iso, 0, 10);
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
            $out[] = [
                'loc' => Snapshot::absoluteUrl($s, $p['lang'], $p['path']),
                'lastmod' => self::day($p['updatedAt']),
                'changefreq' => ($s['pageDefaults'][$p['type']] ?? Snapshot::DEFAULT_PAGE_DEFAULTS)['changefreq'],
                'priority' => $p['seo']['priority'],
                'alternates' => self::withDefault($alternates),
            ];
        }

        // Grouped by external id, not slug: two jobs may reuse a slug in different languages and
        // must not become each other's alternates.
        $articlePath = Articles::articlePath();
        $byJob = [];
        foreach ($articles as $a) $byJob[$a['externalId']][] = $a;
        $articleDefaults = $s['pageDefaults']['article'] ?? Snapshot::DEFAULT_PAGE_DEFAULTS;
        foreach ($byJob as $group) {
            $alternates = [];
            foreach ($group as $a) $alternates[$a['lang']] = Snapshot::absoluteUrl($s, $a['lang'], $articlePath($a['lang'], $a['slug']));
            foreach ($group as $a) {
                $out[] = [
                    'loc' => Snapshot::absoluteUrl($s, $a['lang'], $articlePath($a['lang'], $a['slug'])),
                    'lastmod' => self::day($a['updatedAt']),
                    'changefreq' => $articleDefaults['changefreq'],
                    'priority' => $articleDefaults['priority'],
                    'alternates' => self::withDefault($alternates),
                ];
            }
        }

        return $out;
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
     * Not wired up in phase 1: `xml()` throws above PAGE_SIZE rather than paging, so nothing ever
     * calls this yet. Kept because it is cheap and B11b (or phase 2) needs exactly this shape for
     * the deferred `/sitemap-N.xml` index.
     */
    public static function indexXml(string $baseUrl, int $pageCount): string
    {
        $base = rtrim($baseUrl, '/');
        $items = '';
        for ($i = 1; $i <= $pageCount; $i++) {
            $items .= '<sitemap><loc>' . self::xmlEscape("$base/sitemap-$i.xml") . '</loc></sitemap>';
        }

        return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
            . '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . $items . '</sitemapindex>';
    }

    /**
     * Phase 1 ships a single /sitemap.xml: above PAGE_SIZE URLs this throws rather than silently
     * truncating or paging. The sitemap index that would split a bigger site across
     * /sitemap-N.xml is deferred to phase 2 (controller ruling for this task) — see indexXml().
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

    public static function robots(?array $snapshot): string
    {
        if (!$snapshot) return "User-agent: *\nAllow: /\n";
        $s = $snapshot['settings'];
        if (!($s['indexingEnabled'] ?? true)) return "User-agent: *\nDisallow: /\n";
        $urls = $s['baseUrls'] ?? [];
        $base = rtrim(reset($urls) ?: '', '/');
        $lines = array_merge(['User-agent: *', 'Allow: /'], array_filter($s['robotsExtra'] ?? []));
        if ($base !== '') $lines = array_merge($lines, ['', "Sitemap: $base/sitemap.xml"]);

        return implode("\n", $lines) . "\n";
    }
}
