<?php
/**
 * wp-env only. Mapped into wp-content/mu-plugins by .wp-env.json — never shipped as part of the
 * Doitrous SEO plugin itself and never present on a real site.
 *
 * The conformance suite's resolve.test.mjs asserts JSON-LD escaping against the raw HTML of an
 * actual rendered page (not just the /api/seo/probe API), because that is what proves a renderer
 * serializes resolveSeo's output safely. It fetches `${BASE}/en` after syncing a page record at
 * that exact path. A fresh wp-env install has neither pretty permalinks nor any page at that
 * slug, so both are seeded here, once, idempotently.
 */

if (!defined('ABSPATH')) exit;

// Every other demo in the fleet (examples/express-demo, examples/next-demo,
// examples/laravel-demo) is configured with `supported: ['en', 'ar']`; the conformance suite's
// health.test.mjs ingests a two-language article and expects both to land. Without this, the
// plugin's default (the site's own single language) would silently skip the 'ar' half.
add_filter('doitrous_seo_supported_languages', fn () => ['en', 'ar']);

add_action('init', function () {
    $changed = false;

    if (get_option('permalink_structure') !== '/%postname%/') {
        update_option('permalink_structure', '/%postname%/');
        $changed = true;
    }

    if (!get_page_by_path('en', OBJECT, 'page')) {
        wp_insert_post([
            'post_title' => 'EN', 'post_name' => 'en', 'post_status' => 'publish',
            'post_type' => 'page', 'post_content' => 'Conformance demo page.',
        ]);
        $changed = true;
    }

    if ($changed) flush_rewrite_rules();
}, 20);
