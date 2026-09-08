<?php
/**
 * Plugin Name: Doitrous SEO
 * Description: seo-hub runtime for WordPress. The hub decides page SEO, redirects, sitemap and robots; this plugin renders them.
 * Version: 0.1.2
 * Requires at least: 6.0
 * Requires PHP: 8.0
 *
 * Config: define these in wp-config.php (or set as environment variables) — nothing else is read.
 *
 *   define('SEO_HUB_URL', 'https://hub.example.com');
 *   define('SEO_HUB_SECRET', '...');
 *   define('SEO_SITE_SLUG', 'my-site');
 *
 * Apache/FPM on most shared hosts strip the incoming Authorization header before PHP ever sees
 * it as HTTP_AUTHORIZATION. If every authenticated route answers 401 even with a correct Bearer
 * secret, add this to the site's .htaccess (or the vhost) so mod_rewrite passes it through:
 *
 *   SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
 */

if (!defined('ABSPATH')) exit;

define('DOITROUS_SEO_VERSION', '0.1.2');
define('DOITROUS_SEO_DIR', plugin_dir_path(__FILE__));
define('DOITROUS_SEO_MAX_BODY', 2 * 1024 * 1024);

// redirects.php, sitemap.php and articles.php ship in B12b; file_exists keeps this plugin
// bootable with only the four B12 files present, and B12b needs no change here at all.
foreach (['store', 'resolve', 'redirects', 'sitemap', 'articles', 'head', 'routes'] as $part) {
    $file = DOITROUS_SEO_DIR . "includes/$part.php";
    if (file_exists($file)) require_once $file;
}

register_activation_hook(__FILE__, function () {
    doitrous_seo_install();
    // Boot pull: the render path never talks to the network, so activation is the one moment a
    // fresh install can have SEO before the first 6-hourly cron tick.
    doitrous_seo_pull_snapshot();
});
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('doitrous_seo_pull');
    wp_clear_scheduled_hook('doitrous_seo_health');
});

/** The two required values, from wp-config.php constants or the environment. Nothing else. */
function doitrous_seo_config(): array {
    return [
        'hubUrl' => rtrim((string) (defined('SEO_HUB_URL') ? SEO_HUB_URL : getenv('SEO_HUB_URL')), '/'),
        'secret' => (string) (defined('SEO_HUB_SECRET') ? SEO_HUB_SECRET : getenv('SEO_HUB_SECRET')),
        'slug' => (string) (defined('SEO_SITE_SLUG') ? SEO_SITE_SLUG : getenv('SEO_SITE_SLUG')),
    ];
}

/**
 * Where this site serves an article. Filterable, because no two sites in the fleet agree:
 *   add_filter('doitrous_seo_article_path', fn ($p, $lang, $slug) => "/$lang/articles/$slug", 10, 3);
 */
function doitrous_seo_article_path(string $lang, string $slug): string {
    return (string) apply_filters('doitrous_seo_article_path', "/$lang/blog/$slug", $lang, $slug);
}

add_action('init', 'doitrous_seo_register_routes', 0);
// redirects.php (B12b) supplies the handler; nothing to run against yet is not an error.
if (function_exists('doitrous_seo_apply_redirect')) {
    add_action('template_redirect', 'doitrous_seo_apply_redirect', 1);
}
add_action('wp_head', 'doitrous_seo_print_head', 1);
add_action('doitrous_seo_pull', 'doitrous_seo_pull_snapshot');
add_action('doitrous_seo_health', 'doitrous_seo_send_health');

/**
 * WP-Cron: the contract's 6 h pull and hourly health ping.
 * WordPress ships hourly / twicedaily / daily and nothing in between, so the six-hourly interval
 * has to be registered before it can be scheduled — `twicedaily` is 12 h and off-contract.
 */
add_filter('cron_schedules', function (array $schedules): array {
    $schedules['doitrous_seo_sixhourly'] = ['interval' => 6 * HOUR_IN_SECONDS, 'display' => 'Every six hours'];

    return $schedules;
});

add_action('init', function () {
    if (!wp_next_scheduled('doitrous_seo_pull')) {
        wp_schedule_event(time(), 'doitrous_seo_sixhourly', 'doitrous_seo_pull');
    }
    if (!wp_next_scheduled('doitrous_seo_health')) {
        wp_schedule_event(time(), 'hourly', 'doitrous_seo_health');
    }
});

/** Boot pull: GET {hub}/api/sites/{slug}/snapshot. Never runs on page render. */
function doitrous_seo_pull_snapshot(): string {
    $cfg = doitrous_seo_config();
    $slug = $cfg['slug'] ?: (doitrous_seo_get_snapshot()['siteSlug'] ?? '');
    if ($cfg['hubUrl'] === '' || $cfg['secret'] === '' || $slug === '') return 'failed';
    $res = wp_remote_get($cfg['hubUrl'] . '/api/sites/' . rawurlencode($slug) . '/snapshot', [
        'headers' => ['Authorization' => 'Bearer ' . $cfg['secret']], 'timeout' => 15,
    ]);
    if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) return 'failed';
    $out = doitrous_seo_apply(json_decode(wp_remote_retrieve_body($res), true));

    return $out['status'] === 'invalid' ? 'failed' : $out['status'];
}

/** Hourly ping. The hit counters are drained only after the hub answers 2xx. */
function doitrous_seo_send_health(): bool {
    $cfg = doitrous_seo_config();
    if ($cfg['hubUrl'] === '' || $cfg['secret'] === '') return false;
    $body = doitrous_seo_health_payload();
    if ($body['siteSlug'] === '') return false;
    $res = wp_remote_post($cfg['hubUrl'] . '/api/runtime/health', [
        'headers' => ['Authorization' => 'Bearer ' . $cfg['secret'], 'Content-Type' => 'application/json'],
        'body' => wp_json_encode($body), 'timeout' => 15,
    ]);
    if (is_wp_error($res) || wp_remote_retrieve_response_code($res) >= 300) return false;
    doitrous_seo_take_hits($body['redirectHits']);

    return true;
}
