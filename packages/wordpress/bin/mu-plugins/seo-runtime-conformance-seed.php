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

/**
 * Phase 5's readability.test.mjs (packages/conformance/suite) checks exactly these two paths for
 * >= 200 words of real SSR text, exactly one <h1>, no skipped heading level, a <main> wrapper,
 * and — for /ar — dir="rtl" with its own JSON-LD. Two things rule out leaving this to the site's
 * theme: a generic theme's page template can't be trusted to produce a predictable heading
 * outline or even guarantee a <main> element, and doitrous_seo_site_lang() (includes/routes.php)
 * has no per-request override without a multilingual plugin, so a plain WP page at /ar would
 * still resolve SEO in the site's single global locale. Every other demo in the fleet renders its
 * own home directly rather than trusting a theme; this does the same, with the language passed
 * straight through instead of guessed. Registered ahead of the theme, behind the plugin's own
 * redirect handling (priority 1) so a hub redirect still wins if one is ever configured for
 * either path.
 */
add_action('template_redirect', function () {
    $path = doitrous_seo_normalize_path(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $pages = [
        '/en' => ['lang' => 'en', 'dir' => 'ltr', 'body' => '<main>
<h1>Home</h1>
<p>This page is the reference home for the seo-runtime WordPress demo. It exists to prove, end
to end, that a single hub-authored snapshot can drive every rendered surface of a site: the page
title and meta description, the canonical URL, the Open Graph and Twitter cards, the JSON-LD
blocks, and the newer additions from this runtime\'s AI-readability work — a per-crawler robots
policy, verified ownership meta tags, an analytics snippet, an IndexNow key file, and the author,
help and tool page types. None of that content is hand-written in this plugin; every one of
those fields comes from whatever snapshot the most recent sync call applied to this site\'s
store, which is exactly what the conformance suite exercises against this very page on every
run.</p>
<h2>What the runtime renders here</h2>
<p>Every tag inside the document head is generated the same way: doitrous_seo_resolve reads the
page record stored under this exact path and language, doitrous_seo_compose turns that record
plus the site\'s settings into a title, a description, a canonical link, a set of alternate
language links, a robots directive and a list of JSON-LD blocks, and doitrous_seo_head_tags
prints all of it here directly, ahead of the theme. Nothing on this page is written per route by
hand; the same small set of functions renders whatever page the most recently synced snapshot
happens to describe next, in whichever language a visitor asked for.</p>
<h2>Why word count and heading structure matter here</h2>
<p>Search engines and AI answer engines alike reward pages that carry enough real, extractable
text and a clean heading outline: a single top-level heading, and no jump from one heading level
straight past its immediate child level to a deeper one. This page is deliberately written long
enough, and structured plainly enough, to satisfy that bar on its own, not because the runtime
enforces any particular prose length or heading shape, but because a demo built to prove
AI-readability conformance ought to actually read well to a person and to a machine alike.</p>
</main>'],
        '/ar' => ['lang' => 'ar', 'dir' => 'rtl', 'body' => '<main dir="rtl">
<h1>الرئيسية</h1>
<p>هذه هي الصفحة الرئيسية التوضيحية لإضافة WordPress التي تعرض حزمة seo-runtime. تأتي كل عناصر
البيانات الوصفية والروابط والبيانات المنظمة من اللقطة (snapshot) التي أرسلها المحور (hub) عبر نقطة
المزامنة، وليست مكتوبة داخل هذه الإضافة. تستخدم هذه الصفحة اتجاه الكتابة من اليمين إلى اليسار
توافقًا مع اللغة العربية، وتحمل بياناتها المنظمة الخاصة بها المستقلة عن أي صفحة أخرى في الموقع.</p>
</main>'],
    ];
    if (!isset($pages[$path])) return;
    $p = $pages[$path];
    $seo = doitrous_seo_resolve($path, $p['lang']);
    header('Content-Type: text/html; charset=UTF-8');
    echo '<!doctype html><html lang="' . esc_attr($p['lang']) . '" dir="' . esc_attr($p['dir']) . '">'
        . '<head>' . doitrous_seo_head_tags($seo) . '</head><body>' . $p['body'] . '</body></html>';
    exit;
}, 5);
