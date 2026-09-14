<?php

if (!defined('ABSPATH')) exit;

function doitrous_seo_is_reserved(string $path, array $reserved): bool {
    $p = doitrous_seo_normalize_path($path);
    foreach ($reserved as $r) {
        $prefix = doitrous_seo_normalize_path((string) $r);
        if ($p === $prefix || str_starts_with($p, $prefix . '/')) return true;
    }

    return false;
}

/**
 * template_redirect priority 1: after WP has resolved the URL but before redirect_canonical
 * (registered on the same hook at its default priority 10) or the theme renders anything. A
 * matching row exits here, so WordPress's own trailing-slash canonicalization never sees a
 * redirect source path.
 */
function doitrous_seo_apply_redirect(): void {
    if (is_admin()) return;
    $path = doitrous_seo_normalize_path(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $settings = doitrous_seo_get_settings() ?? [];
    // v2: /{key}.txt for IndexNow key verification. Checked here rather than as a rewrite rule —
    // a pattern broad enough to catch any key would also shadow a theme's own top-level *.txt
    // handling even when no key is configured; this checks the ONE exact expected path and falls
    // through to the redirect/render below for everything else.
    $key = doitrous_seo_index_now_key_file($settings, $path);
    if ($key !== null) {
        // This fires on `template_redirect`, after WP has already decided the request is a 404
        // (nothing in the DB lives at /{key}.txt) and sent that status via send_headers(). Only
        // echoing the body would leave the 404 status line already sent to the client; the key
        // file must answer 200.
        status_header(200);
        header('Content-Type: text/plain; charset=UTF-8');
        echo $key;
        exit;
    }
    // /api, /admin, /wp-admin and /wp-json are always reserved, on top of whatever the hub
    // configured — unioned in, not defaulted, so `reservedPrefixes: []` from the hub can never
    // unreserve /api or /admin.
    $reserved = array_merge(['/api', '/admin'], $settings['reservedPrefixes'] ?? [], ['/wp-admin', '/wp-json', '/wp-login.php']);
    if (doitrous_seo_is_reserved($path, $reserved)) return;
    $row = doitrous_seo_get_redirect($path);
    if (!$row) return;
    // Belt and braces: sanitize() already drops an unsafe destination at sync time, but a render
    // path must never trust a stored value without checking it again.
    $destination = doitrous_seo_safe_destination($row['destination']);
    if ($destination === null) return;
    doitrous_seo_increment_hit($path);
    $status = in_array((int) $row['type'], [301, 302, 307, 308], true) ? (int) $row['type'] : 301;
    wp_redirect($destination, $status);
    exit;
}
