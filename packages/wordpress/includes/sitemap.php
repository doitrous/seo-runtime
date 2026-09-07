<?php

if (!defined('ABSPATH')) exit;

// The per-file URL limit from CONTRACT.md. Phase 1 ships a single /sitemap.xml only — no sitemap
// index / /sitemap-N.xml route (that is deferred to phase 2, controller ruling for this task) —
// so going over the limit is answered 500 with a clear message, never a silently truncated 200.
const DOITROUS_SEO_SITEMAP_PAGE_SIZE = 5000;

// WordPress ships its own sitemap at /wp-sitemap.xml and would advertise it in robots.txt. The
// hub owns the sitemap now, so WP's is switched off entirely.
add_filter('wp_sitemaps_enabled', '__return_false');

function doitrous_seo_xml_escape(string $s): string {
    return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'], $s);
}

function doitrous_seo_with_default(array $alternates): array {
    $lang = isset($alternates['en']) ? 'en' : array_key_first($alternates);
    if ($lang !== null) $alternates['x-default'] = $alternates[$lang];

    return $alternates;
}

/** Omits lastmod for anything shorter than a 10-char ISO date, mirroring sitemap.ts's NaN guard. */
function doitrous_seo_sitemap_lastmod(string $iso): ?string {
    return strlen($iso) >= 10 ? substr($iso, 0, 10) : null;
}

/** Ports core-js's sitemapEntries field for field. */
function doitrous_seo_sitemap_entries(array $snapshot, array $articles): array {
    $s = $snapshot['settings'];
    if (!($s['indexingEnabled'] ?? true)) return [];
    $out = [];

    $byGroup = [];
    foreach ($snapshot['pages'] as $p) $byGroup[$p['group']][] = $p;
    foreach ($snapshot['pages'] as $p) {
        if (!($p['seo']['index'] ?? true) || !($p['seo']['includeInSitemap'] ?? true)) continue;
        $group = $p['group'] ? ($byGroup[$p['group']] ?? [$p]) : [$p];
        $alternates = [];
        foreach ($group as $g) $alternates[$g['lang']] = doitrous_seo_absolute_url($s, $g['lang'], $g['path']);
        $typeDefaults = $s['pageDefaults'][$p['type']] ?? DOITROUS_SEO_PAGE_DEFAULTS;
        $out[] = [
            'loc' => doitrous_seo_absolute_url($s, $p['lang'], $p['path']),
            'lastmod' => doitrous_seo_sitemap_lastmod($p['updatedAt']),
            'changefreq' => $typeDefaults['changefreq'],
            'priority' => $p['seo']['priority'] ?? $typeDefaults['priority'] ?? 0.5,
            'alternates' => doitrous_seo_with_default($alternates),
        ];
    }

    // Grouped by external id, not slug: two different jobs may reuse the same slug in different
    // languages and must not become each other's alternates.
    $articleDefaults = $s['pageDefaults']['article'] ?? DOITROUS_SEO_PAGE_DEFAULTS;
    $byJob = [];
    foreach ($articles as $a) $byJob[$a['externalId']][] = $a;
    foreach ($byJob as $group) {
        $alternates = [];
        foreach ($group as $a) $alternates[$a['lang']] = doitrous_seo_absolute_url($s, $a['lang'], doitrous_seo_article_path($a['lang'], $a['slug']));
        foreach ($group as $a) {
            $out[] = [
                'loc' => doitrous_seo_absolute_url($s, $a['lang'], doitrous_seo_article_path($a['lang'], $a['slug'])),
                'lastmod' => doitrous_seo_sitemap_lastmod($a['updatedAt']),
                'changefreq' => $articleDefaults['changefreq'],
                // Same fallback chain as a page: the type default, then DOITROUS_SEO_PAGE_DEFAULTS.
                // No per-type magic number.
                'priority' => $articleDefaults['priority'],
                'alternates' => doitrous_seo_with_default($alternates),
            ];
        }
    }

    return $out;
}

function doitrous_seo_urlset(array $entries): string {
    $urls = '';
    foreach ($entries as $e) {
        $alts = '';
        foreach ($e['alternates'] as $lang => $href) {
            $alts .= '<xhtml:link rel="alternate" hreflang="' . doitrous_seo_xml_escape((string) $lang) . '" href="' . doitrous_seo_xml_escape($href) . '"/>';
        }
        $urls .= '<url><loc>' . doitrous_seo_xml_escape($e['loc']) . '</loc>'
            . ($e['lastmod'] ? '<lastmod>' . $e['lastmod'] . '</lastmod>' : '')
            . '<changefreq>' . doitrous_seo_xml_escape($e['changefreq']) . '</changefreq>'
            . '<priority>' . number_format((float) $e['priority'], 1) . '</priority>'
            . $alts . '</url>';
    }

    return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
        . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
        . $urls . '</urlset>';
}

/**
 * A single /sitemap.xml, mirroring packages/express's own route: over the 5,000-URL limit is a
 * 500 in plain text, not a sitemap index (deferred to phase 2) and not a silently truncated 200.
 */
function doitrous_seo_route_sitemap(): void {
    $snapshot = doitrous_seo_get_snapshot();
    if (!$snapshot) {
        header('Content-Type: application/xml; charset=UTF-8');
        echo doitrous_seo_urlset([]);
        exit;
    }
    $entries = doitrous_seo_sitemap_entries($snapshot, doitrous_seo_list_articles());
    if (count($entries) > DOITROUS_SEO_SITEMAP_PAGE_SIZE) {
        status_header(500);
        header('Content-Type: text/plain; charset=UTF-8');
        echo 'sitemap error: sitemap has ' . count($entries) . ' URLs, over the ' . DOITROUS_SEO_SITEMAP_PAGE_SIZE
            . '-URL per-file limit; the sitemap index that would split this across multiple files is deferred to phase 2';
        exit;
    }
    header('Content-Type: application/xml; charset=UTF-8');
    echo doitrous_seo_urlset($entries);
    exit;
}

function doitrous_seo_route_robots(): void {
    header('Content-Type: text/plain; charset=UTF-8');
    $snapshot = doitrous_seo_get_snapshot();
    if (!$snapshot) { echo "User-agent: *\nAllow: /\n"; exit; }
    $s = $snapshot['settings'];
    if (!($s['indexingEnabled'] ?? true)) { echo "User-agent: *\nDisallow: /\n"; exit; }
    $urls = $s['baseUrls'] ?? [];
    $base = rtrim(reset($urls) ?: '', '/');
    $lines = array_merge(['User-agent: *', 'Allow: /'], array_filter($s['robotsExtra'] ?? []));
    if ($base !== '') $lines = array_merge($lines, ['', "Sitemap: $base/sitemap.xml"]);
    echo implode("\n", $lines) . "\n";
    exit;
}
