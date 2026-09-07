<?php

if (!defined('ABSPATH')) exit;

/** Anonymous routes; everything else needs the bearer secret. */
const DOITROUS_SEO_PUBLIC_ROUTES = ['GET /sitemap.xml', 'GET /robots.txt'];

function doitrous_seo_register_routes(): void {
    $path = doitrous_seo_normalize_path(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $routes = [
        'POST /api/seo/sync' => 'doitrous_seo_route_sync',
        'GET /api/seo/pages' => 'doitrous_seo_route_pages',
        'GET /api/seo/probe' => 'doitrous_seo_route_probe',
        'GET /api/seo/health' => 'doitrous_seo_route_health',
        'POST /api/articles' => 'doitrous_seo_route_articles',
        'GET /sitemap.xml' => 'doitrous_seo_route_sitemap',
        'GET /robots.txt' => 'doitrous_seo_route_robots',
    ];
    $key = "$method $path";
    if (isset($routes[$key])) {
        // Only the sitemap and robots are public. Health is authenticated: it names the site and
        // enumerates every redirect source path.
        if (!in_array($key, DOITROUS_SEO_PUBLIC_ROUTES, true) && !doitrous_seo_authorized()) {
            doitrous_seo_json(['error' => 'unauthorized'], 401);
        }
        call_user_func($routes[$key]);
        return;
    }
    // Anything else under /api/seo is authenticated before it is a 404, like the Next, Express
    // and Laravel packages: the prefix never confirms which routes exist to an anonymous caller.
    if (str_starts_with($path, '/api/seo/') || $path === '/api/seo') {
        if (!doitrous_seo_authorized()) doitrous_seo_json(['error' => 'unauthorized'], 401);
        doitrous_seo_json(['error' => 'not found'], 404);
    }
}

/**
 * `HTTP_AUTHORIZATION` is stripped by most Apache/FPM setups unless mod_rewrite is told to pass
 * it through, so the header has to be looked for in all three places it can survive. Without
 * this fallback every authenticated route 401s on an ordinary shared host.
 */
function doitrous_seo_auth_header(): string {
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
        if (!empty($_SERVER[$key])) return (string) $_SERVER[$key];
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) return (string) $value;
        }
    }

    return '';
}

function doitrous_seo_authorized(): bool {
    $secret = doitrous_seo_config()['secret'];
    $header = doitrous_seo_auth_header();
    $given = preg_match('/^bearer\s+/i', $header) ? (string) preg_replace('/^bearer\s+/i', '', $header) : '';

    return $secret !== '' && hash_equals($secret, $given);
}

function doitrous_seo_json(array $body, int $status = 200): void {
    status_header($status);
    header('Content-Type: application/json; charset=utf-8');
    echo wp_json_encode($body);
    exit;
}

/**
 * Reads the body with a hard ceiling. `CONTENT_LENGTH` is absent on a chunked request, so the
 * stream is read in chunks and abandoned the moment it passes the limit.
 */
function doitrous_seo_read_body(): mixed {
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > DOITROUS_SEO_MAX_BODY) {
        doitrous_seo_json(['error' => 'too large'], 413);
    }
    $handle = fopen('php://input', 'rb');
    if (!$handle) return null;
    $raw = '';
    while (!feof($handle)) {
        $raw .= (string) fread($handle, 65536);
        if (strlen($raw) > DOITROUS_SEO_MAX_BODY) {
            fclose($handle);
            doitrous_seo_json(['error' => 'too large'], 413);
        }
    }
    fclose($handle);

    return json_decode($raw ?: 'null', true);
}

function doitrous_seo_route_sync(): void {
    // doitrous_seo_read_body() returns null for malformed JSON, and doitrous_seo_apply(null) is
    // already `{status: invalid, version: 0}` -> 400, so invalid JSON needs no separate check.
    $out = doitrous_seo_apply(doitrous_seo_read_body());
    doitrous_seo_json($out, $out['status'] === 'invalid' ? 400 : 200);
}

function doitrous_seo_route_probe(): void {
    doitrous_seo_json(doitrous_seo_resolve(
        (string) ($_GET['path'] ?? '/'),
        (string) ($_GET['lang'] ?? doitrous_seo_site_lang()),
    ));
}

function doitrous_seo_route_health(): void {
    doitrous_seo_json(doitrous_seo_health_payload());
}

/** Busiest source first, capped at 1,000 — the rest wait for the next ping. */
function doitrous_seo_top_hits(array $hits): array {
    usort($hits, fn ($a, $b) => $b['hits'] <=> $a['hits']);

    return array_slice($hits, 0, 1000);
}

function doitrous_seo_health_payload(): array {
    $snapshot = doitrous_seo_get_snapshot();
    $cfg = doitrous_seo_config();

    return [
        'version' => DOITROUS_SEO_VERSION,
        'siteSlug' => $cfg['slug'] ?: ($snapshot['siteSlug'] ?? ''),
        'lastSyncAt' => doitrous_seo_last_sync(),
        'snapshotVersion' => $snapshot['version'] ?? 0,
        'counts' => [
            'pages' => count($snapshot['pages'] ?? []),
            'redirects' => count($snapshot['redirects'] ?? []),
            'articles' => count(doitrous_seo_list_articles()),
            'storeFailures' => doitrous_seo_store_failures(),
        ],
        // Busiest sources first, capped at 1,000: the rest wait for the next ping.
        'redirectHits' => doitrous_seo_top_hits(doitrous_seo_peek_hits()),
    ];
}

/** The site's public posts as provider pages, then the plugin's own article pages. */
function doitrous_seo_route_pages(): void {
    $pages = [];
    foreach (get_post_types(['public' => true], 'names') as $type) {
        if ($type === 'attachment') continue;
        $posts = get_posts(['post_type' => $type, 'post_status' => 'publish', 'numberposts' => 2000, 'suppress_filters' => false]);
        foreach ($posts as $post) {
            $pages[] = [
                'key' => "$type:{$post->ID}",
                'type' => $type === 'page' ? 'page' : $type,
                'lang' => doitrous_seo_post_lang($post->ID),
                'path' => doitrous_seo_normalize_path(parse_url(get_permalink($post), PHP_URL_PATH) ?: '/'),
                'title' => get_the_title($post),
                'updatedAt' => get_post_modified_time('c', true, $post) ?: '',
            ];
        }
    }
    foreach (doitrous_seo_list_articles() as $a) {
        $pages[] = [
            'key' => 'article:' . $a['externalId'], 'type' => 'article', 'lang' => $a['lang'],
            'path' => doitrous_seo_article_path($a['lang'], $a['slug']),
            'title' => $a['title'], 'updatedAt' => $a['updatedAt'],
        ];
    }
    doitrous_seo_json(['pages' => $pages]);
}

/** Polylang and WPML when present; the site language otherwise. */
function doitrous_seo_post_lang(int $postId): string {
    if (function_exists('pll_get_post_language')) {
        $lang = pll_get_post_language($postId, 'slug');
        if ($lang) return (string) $lang;
    }
    $wpml = apply_filters('wpml_post_language_details', null, $postId);
    if (is_array($wpml) && !empty($wpml['language_code'])) return (string) $wpml['language_code'];

    return doitrous_seo_site_lang();
}

function doitrous_seo_site_lang(): string {
    return substr((string) get_bloginfo('language'), 0, 2) ?: 'en';
}
