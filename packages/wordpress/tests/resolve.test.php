<?php
/**
 * Plain-PHP unit test for the composeSeo port, the title template, JSON-LD escaping and the hit
 * take/peek semantics. No WordPress runtime: the handful of WP functions store.php/resolve.php/
 * head.php call are stubbed below. Run with:
 *
 *   php packages/wordpress/tests/resolve.test.php
 *
 * Exits 1 (and prints every failure) if any assertion fails; exits 0 and prints "OK" otherwise.
 */

define('ABSPATH', __DIR__ . '/');

// --- WP function stubs -------------------------------------------------------------------

$GLOBALS['__wp_options'] = [];

function get_option(string $key, $default = false) {
    return $GLOBALS['__wp_options'][$key] ?? $default;
}

function update_option(string $key, $value, $autoload = null): bool {
    $GLOBALS['__wp_options'][$key] = $value;

    return true;
}

function apply_filters(string $tag, $value, ...$args) {
    return $value;
}

function esc_attr(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function esc_html(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function esc_url(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function wp_json_encode($data, int $options = 0): string|false {
    return json_encode($data, $options);
}

// --- load the plugin's includes ---------------------------------------------------------

require_once __DIR__ . '/../includes/store.php';
require_once __DIR__ . '/../includes/resolve.php';
require_once __DIR__ . '/../includes/head.php';

// --- tiny assertion harness --------------------------------------------------------------

$failures = [];
function check(string $label, bool $ok): void {
    global $failures;
    echo ($ok ? "ok - " : "NOT OK - ") . $label . "\n";
    if (!$ok) $failures[] = $label;
}

// === composeSeo precedence: page SEO > page type defaults > settings ======================

$settings = [
    'baseUrls' => ['en' => 'https://example.com', 'ar' => 'https://example.com/ar'],
    'indexingEnabled' => true, 'brandSuffix' => ' | Demo', 'defaultOgImage' => 'https://example.com/og.png',
    'organization' => ['name' => 'Demo Co', 'logo' => '', 'sameAs' => [], 'phone' => '', 'email' => '', 'address' => '', 'hours' => '', 'type' => 'Organization'],
    'robotsExtra' => [], 'pageDefaults' => ['article' => ['titleTemplate' => '%s — Blog', 'schemaType' => 'Article', 'changefreq' => 'weekly', 'priority' => 0.7]],
    'reservedPrefixes' => ['/api', '/admin'], 'twitterHandle' => '',
];

$pageNoSeoTitle = [
    'key' => 'article:1', 'type' => 'article', 'lang' => 'en', 'path' => '/en/a', 'group' => '',
    'title' => 'A Page', 'updatedAt' => '2026-01-01T00:00:00Z',
    'seo' => ['seoTitle' => '', 'metaDescription' => 'About A.', 'canonical' => '', 'index' => true, 'follow' => true,
        'includeInSitemap' => true, 'priority' => 0.5, 'og' => ['title' => '', 'description' => '', 'image' => ''],
        'twitter' => ['title' => '', 'description' => '', 'image' => ''], 'schemaType' => '', 'structuredData' => [], 'faq' => []],
];

// 1. No page seoTitle set -> falls through to the page TYPE's titleTemplate, brand suffix appended.
$seo = doitrous_seo_compose($pageNoSeoTitle, $settings, '/en/a', 'en', [$pageNoSeoTitle]);
check('type default titleTemplate applies when the page has no seoTitle', $seo['title'] === 'A Page — Blog | Demo');

// 2. Page-level seoTitle overrides the type default entirely.
$pageWithSeoTitle = $pageNoSeoTitle;
$pageWithSeoTitle['seo']['seoTitle'] = 'Custom Title';
$seo2 = doitrous_seo_compose($pageWithSeoTitle, $settings, '/en/a', 'en', [$pageWithSeoTitle]);
check('page seoTitle overrides the type default', $seo2['title'] === 'Custom Title | Demo');

// 3. Brand suffix is not duplicated when the title already ends with it.
$pageAlreadySuffixed = $pageWithSeoTitle;
$pageAlreadySuffixed['seo']['seoTitle'] = 'Already Suffixed | Demo';
$seo3 = doitrous_seo_compose($pageAlreadySuffixed, $settings, '/en/a', 'en', [$pageAlreadySuffixed]);
check('brand suffix is not appended twice', $seo3['title'] === 'Already Suffixed | Demo');

// 4. Settings-level default (no page at all) falls back to the organization name.
$seo4 = doitrous_seo_compose(null, $settings, '/en/unknown', 'en');
check('no page -> falls back to the organization name', $seo4['title'] === 'Demo Co | Demo');
check('no page -> canonical is the absolute URL for the path', $seo4['canonical'] === 'https://example.com/en/unknown');

// 5. The organization is the trailing JSON-LD entry.
check('organization is the trailing jsonld entry', end($seo['jsonld'])['@type'] === 'Organization' && end($seo['jsonld'])['name'] === 'Demo Co');

// === title template: only the FIRST %s is substituted (matches JS String.replace) =========

check(
    'doitrous_seo_replace_first substitutes only the first %s',
    doitrous_seo_replace_first('%s', 'X', '%s and %s') === 'X and %s',
);
$twoPercentS = $pageNoSeoTitle;
$settingsTwoS = $settings;
$settingsTwoS['pageDefaults']['article']['titleTemplate'] = '%s / %s';
$seoTwoS = doitrous_seo_compose($twoPercentS, $settingsTwoS, '/en/a', 'en', [$twoPercentS]);
check('composeSeo only fills the first %s of a titleTemplate', $seoTwoS['title'] === 'A Page / %s | Demo');

// === JSON-LD escaping: '<' becomes the six-character < sequence =======================

$evilPage = $pageNoSeoTitle;
$evilPage['seo']['structuredData'] = [
    ['@context' => 'https://schema.org', '@type' => 'WebPage', 'name' => '</script><script>alert(1)</script>'],
];
$evilSeo = doitrous_seo_compose($evilPage, $settings, '/en/a', 'en', [$evilPage]);
$html = doitrous_seo_head_tags($evilSeo);
check('the raw payload never appears as an executable </script> tag', !str_contains($html, '</script><script>alert(1)</script>'));
check('the "<" is escaped as the six-character \u003c sequence', str_contains($html, '\u003c/script>'));

// === safe redirect destinations ===========================================================

// Every browser normalizes a leading "/\" exactly like "//" (`new URL('/\\evil.com', base)`
// resolves to `https://evil.com/`), so safe_destination must reject it the same way.
check('a leading /\\ is rejected like a scheme-relative destination', doitrous_seo_safe_destination('/\\evil.com') === null);

// === resolve() never fatals, even on a corrupt stored page ================================

$corruptPage = [
    'key' => 'bad:1', 'type' => 'page', 'lang' => 'en', 'path' => '/en/bad', 'group' => '',
    'title' => 'Bad', 'updatedAt' => '2026-01-01T00:00:00Z',
    'seo' => [
        'seoTitle' => '', 'metaDescription' => '', 'canonical' => '', 'index' => true, 'follow' => true,
        'includeInSitemap' => true, 'priority' => 0.5, 'og' => ['title' => '', 'description' => '', 'image' => ''],
        'twitter' => ['title' => '', 'description' => '', 'image' => ''], 'schemaType' => '',
        // Wrong type on purpose: array_filter() on a non-array throws a TypeError, which is what
        // this section checks doitrous_seo_resolve catches rather than fataling inside wp_head.
        'structuredData' => 'not-an-array', 'faq' => [],
    ],
];
$GLOBALS['__wp_options']['doitrous_seo_snapshot'] = [
    'version' => 1, 'siteSlug' => '', 'settings' => DOITROUS_SEO_EMPTY_SETTINGS, 'pages' => [$corruptPage], 'redirects' => [],
];
$failuresBefore = doitrous_seo_store_failures();
$corruptSeo = doitrous_seo_resolve('/en/bad', 'en');
check('a corrupt page degrades to the empty resolved shape instead of fataling', $corruptSeo['title'] === '');
check('the store-failure counter increments on the caught throwable', doitrous_seo_store_failures() === $failuresBefore + 1);

// === a cold store refuses a snapshot for another site when SEO_SITE_SLUG is configured ======

$GLOBALS['__wp_options'] = [];
define('SEO_SITE_SLUG', 'demo');
$forOther = ['version' => 1, 'siteSlug' => 'other', 'settings' => DOITROUS_SEO_EMPTY_SETTINGS, 'pages' => [], 'redirects' => []];
$rejected = doitrous_seo_apply($forOther);
check('a mismatched siteSlug is refused on a cold store', $rejected['status'] === 'invalid');
check('the store is still empty after the refusal', doitrous_seo_get_snapshot() === null);
$forMe = ['version' => 1, 'siteSlug' => 'demo', 'settings' => DOITROUS_SEO_EMPTY_SETTINGS, 'pages' => [], 'redirects' => []];
check('the configured siteSlug still applies normally', doitrous_seo_apply($forMe)['status'] === 'applied');

// === hit take/peek semantics =================================================================

$GLOBALS['__wp_options'] = []; // reset options between sections
doitrous_seo_increment_hit('/old-page');
doitrous_seo_increment_hit('/old-page');
doitrous_seo_increment_hit('/old-page');
doitrous_seo_increment_hit('/other');

$peeked = doitrous_seo_peek_hits();
check('peek_hits does not mutate state (still there after peeking twice)', doitrous_seo_peek_hits() === $peeked);

$bySource = [];
foreach ($peeked as $h) $bySource[$h['source']] = $h['hits'];
check('peek reports the counted hits', ($bySource['/old-page'] ?? 0) === 3 && ($bySource['/other'] ?? 0) === 1);

// A hit counted while a health request was "in flight" must survive a take() for less than the total.
doitrous_seo_take_hits([['source' => '/old-page', 'hits' => 3]]);
doitrous_seo_increment_hit('/old-page'); // counted "mid-flight", after the number reported was captured
$afterTake = [];
foreach (doitrous_seo_peek_hits() as $h) $afterTake[$h['source']] = $h['hits'];
check('take_hits drains exactly what was reported, leaving later hits intact', ($afterTake['/old-page'] ?? 0) === 1);
check('take_hits never drains other sources', ($afterTake['/other'] ?? 0) === 1);

doitrous_seo_take_hits([['source' => '/old-page', 'hits' => 999]]);
$floor = [];
foreach (doitrous_seo_peek_hits() as $h) $floor[$h['source']] = $h['hits'];
check('take_hits never drives a counter below zero', !isset($floor['/old-page']));

// --- summary -------------------------------------------------------------------------------

if ($failures) {
    fwrite(STDERR, "\n" . count($failures) . " assertion(s) failed:\n");
    foreach ($failures as $f) fwrite(STDERR, "  - $f\n");
    exit(1);
}

echo "\nOK - " . (count($failures) === 0 ? 'all assertions passed' : '') . "\n";
exit(0);
