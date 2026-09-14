<?php
/**
 * Plain-PHP unit test for Phase 5's v2 fields: crawlerPolicy, entity, authors/helpEntries/tools,
 * verification, ga4MeasurementId and the IndexNow key file. No WordPress runtime — see
 * resolve.test.php's own docblock for why. Run with:
 *
 *   php packages/wordpress/tests/v2.test.php
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

function add_filter(string $tag, $cb, int $priority = 10, int $args = 1): bool {
    return true;
}

function esc_attr(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function esc_html(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function esc_url(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

// wp_kses_post: the real function strips a large denylist; this harness only needs the one property the
// tests assert on — script tags never survive — mirroring the defence-in-depth articles.php already has.
function wp_kses_post(string $html): string {
    return preg_replace('#<script\b[^>]*>.*?</script>#is', '', $html) ?? '';
}

function wp_json_encode($data, int $options = 0): string|false {
    return json_encode($data, $options);
}

// Normally defined in doitrous-seo.php (the main plugin file, never required by this
// includes-only harness — see resolve.test.php's own docblock for why). Empty here on purpose:
// it is what makes doitrous_seo_hub_proxy() take the "misconfigured" branch in the section below
// — the indexnow/vitals tests further down override it locally, per test, when they need a hub.
function doitrous_seo_config(): array {
    return $GLOBALS['__wp_config'] ?? ['hubUrl' => '', 'secret' => '', 'slug' => ''];
}

// A minimal wp_remote_* fake: each test sets $GLOBALS['__wp_remote_response'] to the canned
// answer (WordPress's own shape: ['response' => ['code' => N], 'body' => '...'] or a WP_Error
// stand-in), and reads $GLOBALS['__wp_remote_last'] to see what was actually sent — the JS
// conformance suite drives the real HTTP path; this only proves this file's own request-shaping.
function wp_remote_post(string $url, array $args = []): mixed {
    $GLOBALS['__wp_remote_last'] = ['method' => 'post', 'url' => $url, 'args' => $args];

    return $GLOBALS['__wp_remote_response'];
}
function wp_remote_get(string $url, array $args = []): mixed {
    $GLOBALS['__wp_remote_last'] = ['method' => 'get', 'url' => $url, 'args' => $args];

    return $GLOBALS['__wp_remote_response'];
}
function is_wp_error(mixed $v): bool { return is_array($v) && isset($v['__wp_error']); }
function wp_remote_retrieve_body(mixed $res): string { return is_array($res) ? (string) ($res['body'] ?? '') : ''; }
function wp_remote_retrieve_response_code(mixed $res): int { return is_array($res) ? (int) ($res['response']['code'] ?? 0) : 0; }

// --- load the plugin's includes ---------------------------------------------------------

require_once __DIR__ . '/../includes/store.php';
require_once __DIR__ . '/../includes/resolve.php';
require_once __DIR__ . '/../includes/entities.php';
require_once __DIR__ . '/../includes/head.php';
require_once __DIR__ . '/../includes/sitemap.php';
require_once __DIR__ . '/../includes/approval.php';

// --- tiny assertion harness --------------------------------------------------------------

$failures = [];
function check(string $label, bool $ok): void {
    global $failures;
    echo ($ok ? "ok - " : "NOT OK - ") . $label . "\n";
    if (!$ok) $failures[] = $label;
}

// === robots: per-UA crawler blocks ==========================================================

// doitrous_seo_route_robots() calls exit() directly, which would kill this test process, so this
// checks the one piece of new logic it adds — doitrous_seo_safe_ua() — directly. The full-body
// per-UA rendering is covered by the JS conformance suite's robots test, which runs against a
// live server instead of an in-process require.
check(
    'a UA name is used verbatim when it has no newline',
    doitrous_seo_safe_ua('ClaudeBot') === 'ClaudeBot',
);
check(
    'a UA name with an injected newline has it stripped, never becoming a second robots.txt line',
    doitrous_seo_safe_ua("Evil\nDisallow: /secret") === 'EvilDisallow: /secret',
);

// === entity JSON-LD: schema.org-shaped is kept, anything else is dropped ==================

$settingsWithEntity = DOITROUS_SEO_EMPTY_SETTINGS;
$settingsWithEntity['baseUrls'] = ['en' => 'https://example.com'];
$settingsWithEntity['entity'] = ['@context' => 'https://schema.org', '@type' => 'MedicalOrganization'];
$seoWithEntity = doitrous_seo_compose(null, $settingsWithEntity, '/en', 'en');
check('a schema.org-shaped entity is appended to jsonld', end($seoWithEntity['jsonld'])['@type'] === 'MedicalOrganization');

$settingsBadEntity = DOITROUS_SEO_EMPTY_SETTINGS;
$settingsBadEntity['entity'] = ['name' => 'no context'];
$seoBadEntity = doitrous_seo_compose(null, $settingsBadEntity, '/en', 'en');
check('an entity with no @context never reaches jsonld', empty(array_filter($seoBadEntity['jsonld'], fn ($e) => ($e['name'] ?? null) === 'no context')));

// === sanitize: an invalid entity is dropped at sync time, a valid one survives ============

$snapshotBad = ['version' => 1, 'siteSlug' => '', 'settings' => ['entity' => ['name' => 'no context']], 'pages' => [], 'redirects' => []];
$sanitizedBad = doitrous_seo_sanitize($snapshotBad);
check('sanitize drops a non-schema.org entity', $sanitizedBad['settings']['entity'] === null);

$snapshotGood = ['version' => 1, 'siteSlug' => '', 'settings' => ['entity' => ['@context' => 'https://schema.org', '@type' => 'Thing']], 'pages' => [], 'redirects' => []];
$sanitizedGood = doitrous_seo_sanitize($snapshotGood);
check('sanitize keeps a schema.org-shaped entity', $sanitizedGood['settings']['entity']['@type'] === 'Thing');

// === authors/helpEntries/tools: find + JSON-LD + body HTML =================================

$author = ['slug' => 'jane', 'name' => 'Jane Doe', 'title' => 'Editor', 'credentials' => 'MD', 'sameAs' => ['https://x.example/jane'], 'bio' => 'Bio.'];
$settingsWithAuthor = array_merge(DOITROUS_SEO_EMPTY_SETTINGS, ['authors' => [$author]]);
check('find_author looks up by slug', doitrous_seo_find_author($settingsWithAuthor, 'jane')['name'] === 'Jane Doe');
check('find_author returns null for an unknown slug', doitrous_seo_find_author($settingsWithAuthor, 'nope') === null);

$personLd = doitrous_seo_person_jsonld($author, 'https://site/authors/jane');
check('personJsonLd is a Person with the optional fields', $personLd['@type'] === 'Person' && $personLd['jobTitle'] === 'Editor' && $personLd['sameAs'] === ['https://x.example/jane']);

$authorHtml = doitrous_seo_author_body_html(['slug' => 'x', 'name' => '<script>x</script>', 'title' => '', 'credentials' => '', 'sameAs' => [], 'bio' => '']);
check('authorBodyHtml escapes the name', !str_contains($authorHtml, '<script>x</script>') && str_contains($authorHtml, '&lt;script&gt;'));

$helpEntry = ['slug' => 'refund', 'lang' => 'en', 'question' => 'How do refunds work?', 'answerHtml' => '<p>Answer.</p>', 'moneyPageUrl' => '/pricing', 'updatedAt' => '2026-09-01T00:00:00.000Z'];
$helpLd = doitrous_seo_help_article_jsonld($helpEntry, 'https://site/help/refund');
check('helpArticleJsonLd is an Article with dateModified and the question as headline', $helpLd['@type'] === 'Article' && $helpLd['headline'] === 'How do refunds work?' && $helpLd['dateModified'] === '2026-09-01T00:00:00.000Z');
$helpHtml = doitrous_seo_help_body_html($helpEntry);
check('helpBodyHtml puts the question in an h1 and the answer first, verbatim HTML', str_starts_with($helpHtml, '<h1>How do refunds work?</h1>') && str_contains($helpHtml, '<p>Answer.</p>'));

$tool = ['slug' => 'calc', 'lang' => 'en', 'kind' => 'Calculator', 'config' => [], 'methodologyHtml' => '<p>Method.</p>', 'dataSource' => 'ONS', 'asOf' => '2026-08-01'];
$toolLd = doitrous_seo_tool_jsonld($tool, 'https://site/tools/calc');
check('toolJsonLd is a WebApplication', $toolLd['@type'] === 'WebApplication');
$toolHtml = doitrous_seo_tool_body_html($tool);
check('toolBodyHtml renders the placeholder container and methodology block', str_contains($toolHtml, 'id="seo-tool-calc"') && str_contains($toolHtml, '<p>Method.</p>'));

// --- wp_kses_post defence-in-depth on hub-supplied HTML (review finding, PR #1) ------------------
$xssHelp = ['slug' => 'x', 'lang' => 'en', 'question' => 'Q?', 'answerHtml' => '<p>ok</p><script>alert(1)</script>', 'moneyPageUrl' => '', 'updatedAt' => '2026-09-01T00:00:00.000Z'];
check('helpBodyHtml passes answerHtml through wp_kses_post (script stripped)', !str_contains(doitrous_seo_help_body_html($xssHelp), '<script') && str_contains(doitrous_seo_help_body_html($xssHelp), '<p>ok</p>'));
$xssTool = ['slug' => 't', 'lang' => 'en', 'kind' => 'cost-estimator', 'config' => [], 'methodologyHtml' => '<p>m</p><script>alert(1)</script>', 'dataSource' => '', 'asOf' => ''];
check('toolBodyHtml passes methodologyHtml through wp_kses_post (script stripped)', !str_contains(doitrous_seo_tool_body_html($xssTool), '<script') && str_contains(doitrous_seo_tool_body_html($xssTool), '<p>m</p>'));

// === verification + ga4 ====================================================================

check('verificationMetaTags renders only the tags that are set', str_contains(doitrous_seo_verification_meta_tags(['googleMeta' => 'abc']), 'google-site-verification') && !str_contains(doitrous_seo_verification_meta_tags(['googleMeta' => 'abc']), 'msvalidate'));
check('verificationMetaTags is empty for null', doitrous_seo_verification_meta_tags(null) === '');
check('gtagSnippet only emits for a safe measurement id', str_contains(doitrous_seo_gtag_snippet('G-ABC123'), "gtag('config','G-ABC123')"));
check('gtagSnippet drops an unsafe measurement id', doitrous_seo_gtag_snippet("G-ABC'); alert(1); //") === '');

// === IndexNow key file ======================================================================

$settingsWithKey = array_merge(DOITROUS_SEO_EMPTY_SETTINGS, ['indexNowKey' => 'abc123']);
check('indexNowKeyFile matches the exact /{key}.txt path', doitrous_seo_index_now_key_file($settingsWithKey, '/abc123.txt') === 'abc123');
check('indexNowKeyFile returns null for any other path', doitrous_seo_index_now_key_file($settingsWithKey, '/other.txt') === null);
check('indexNowKeyFile returns null when no key is configured', doitrous_seo_index_now_key_file(DOITROUS_SEO_EMPTY_SETTINGS, '/abc123.txt') === null);

// === pending/approve proxy ==================================================================

// doitrous_seo_config() reads SEO_HUB_URL/SECRET/SLUG from constants/env, none of which this
// stub environment defines, so doitrous_seo_hub_proxy() answers "misconfigured" before it would
// ever call wp_remote_get/post (also unstubbed here — the JS conformance suite drives a real
// wp-env request for the happy path).
check('pending is 502-shaped when the runtime is not configured', doitrous_seo_pending()['status'] === 502);
check('approvalAction is 400 without a jobId or approvedBy', doitrous_seo_approval_action('approve', '', 'Jane')['status'] === 400);
check('approvalAction is 400 without an approvedBy', doitrous_seo_approval_action('approve', '1', '')['status'] === 400);

// === v2: IndexNow ===========================================================================

check('index_now is 502-shaped without an indexNowKey', doitrous_seo_index_now(['https://example.com/en/a'])['status'] === 502);

doitrous_seo_put_snapshot(['settings' => array_merge(DOITROUS_SEO_EMPTY_SETTINGS, ['indexNowKey' => 'the-key'])]);
check('index_now is 400 for an empty urlList', doitrous_seo_index_now([])['status'] === 400);
check('index_now is 400 when the first entry is not a URL at all', doitrous_seo_index_now(['not a url'])['status'] === 400);

$GLOBALS['__wp_remote_response'] = ['response' => ['code' => 200], 'body' => ''];
$indexNowOut = doitrous_seo_index_now(['https://example.com/en/a', 'https://other.example/x']);
check('index_now posts host/key/keyLocation to api.indexnow.org', $GLOBALS['__wp_remote_last']['url'] === 'https://api.indexnow.org/indexnow');
$indexNowBody = json_decode($GLOBALS['__wp_remote_last']['args']['body'], true);
check(
    'index_now drops a URL for a different host and forwards the site key',
    $indexNowBody['host'] === 'example.com' && $indexNowBody['key'] === 'the-key'
    && $indexNowBody['keyLocation'] === 'https://example.com/the-key.txt' && $indexNowBody['urlList'] === ['https://example.com/en/a'],
);
check('index_now relays the 200 status through', $indexNowOut['status'] === 200);

doitrous_seo_put_snapshot(['settings' => DOITROUS_SEO_EMPTY_SETTINGS]);   // restore for the rest of this file

// === v2: the opt-in web-vitals beacon =======================================================

check('vitals is 502-shaped when the runtime is not configured', doitrous_seo_vitals(['url' => 'https://example.com/en/a'])['status'] === 502);

$GLOBALS['__wp_config'] = ['hubUrl' => 'https://hub.test', 'secret' => 'sekret', 'slug' => 'demo'];
check('vitals is 400 without a url', doitrous_seo_vitals([])['status'] === 400);

$GLOBALS['__wp_remote_response'] = ['response' => ['code' => 204], 'body' => ''];
$vitalsOut = doitrous_seo_vitals(['url' => 'https://example.com/en/a', 'lcp' => 1200, 'inp' => 50, 'cls' => 0.01]);
check('vitals posts to the hub with the site secret as Bearer', $GLOBALS['__wp_remote_last']['url'] === 'https://hub.test/api/runtime/vitals');
check('vitals attaches the secret server-side, never expecting it from the caller', $GLOBALS['__wp_remote_last']['args']['headers']['Authorization'] === 'Bearer sekret');
$vitalsBody = json_decode($GLOBALS['__wp_remote_last']['args']['body'], true);
check('vitals body carries siteSlug, the sample and source:rum', $vitalsBody['siteSlug'] === 'demo' && $vitalsBody['url'] === 'https://example.com/en/a' && $vitalsBody['source'] === 'rum');
check('vitals relays the hub status through', $vitalsOut['status'] === 204);

$GLOBALS['__wp_config'] = null;   // restore the misconfigured default for anything after this

check(
    "web_vitals_snippet posts to this site's own /api/seo/vitals, never a hub URL or a secret",
    str_contains(doitrous_seo_web_vitals_snippet(), "sendBeacon('/api/seo/vitals'") && !str_contains(doitrous_seo_web_vitals_snippet(), 'http://') && !str_contains(doitrous_seo_web_vitals_snippet(), 'https://'),
);

// --- summary -------------------------------------------------------------------------------

if ($failures) {
    fwrite(STDERR, "\n" . count($failures) . " assertion(s) failed:\n");
    foreach ($failures as $f) fwrite(STDERR, "  - $f\n");
    exit(1);
}

echo "\nOK - all assertions passed\n";
exit(0);
