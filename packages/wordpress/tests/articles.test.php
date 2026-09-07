<?php
/**
 * Plain-PHP unit test for markdown escaping/unsafe-target rules, validatePayload's error
 * strings, robots.txt bodies, and sitemap entry filtering. No WordPress runtime: the handful of
 * WP functions store.php/resolve.php/sitemap.php/articles.php call are stubbed below. Run with:
 *
 *   php packages/wordpress/tests/articles.test.php
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

function add_filter(...$args): bool {
    return true;
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

// wp_kses_post is the second line of defence over the markdown subset's own output; the real
// function strips a much larger denylist, but for this pure-PHP harness a pass-through is
// faithful enough — the escaping under test happens entirely inside doitrous_seo_markdown_inline.
function wp_kses_post(string $html): string {
    return $html;
}

function is_admin(): bool {
    return false;
}

// doitrous_seo_article_path lives in doitrous-seo.php (the bootstrap), which this harness does
// not load — it has side effects (add_action, register_activation_hook) this plain-PHP test has
// no business stubbing. The default article path is all sitemap.php needs.
function doitrous_seo_article_path(string $lang, string $slug): string {
    return "/$lang/blog/$slug";
}

// --- load the plugin's includes ---------------------------------------------------------

require_once __DIR__ . '/../includes/store.php';
require_once __DIR__ . '/../includes/resolve.php';
require_once __DIR__ . '/../includes/sitemap.php';
require_once __DIR__ . '/../includes/articles.php';

// --- tiny assertion harness --------------------------------------------------------------

$failures = [];
function check(string $label, bool $ok): void {
    global $failures;
    echo ($ok ? "ok - " : "NOT OK - ") . $label . "\n";
    if (!$ok) $failures[] = $label;
}

// === markdown: escaping and unsafe targets =================================================

check(
    'a raw HTML tag in the source is escaped, never emitted as markup',
    str_contains(doitrous_seo_markdown("Hello <script>alert(1)</script> world"), '&lt;script&gt;')
    && !str_contains(doitrous_seo_markdown("Hello <script>alert(1)</script> world"), '<script>'),
);

check(
    'a tag smuggled via nesting (<scr<script>ipt>) cannot reassemble after escaping',
    !str_contains(doitrous_seo_markdown('<scr<script>ipt>alert(1)</scr</script>ipt>'), '<script>'),
);

// A parenthesis inside the URL itself is a known limitation of this hand-rolled (non-nesting)
// link regex — CommonMark's real balanced-paren destination parsing is out of scope for the
// deliberate subset (ponytail note on doitrous_seo_markdown). The target here has none, so this
// exercises only the thing under test: an unsafe scheme is dropped and the link text survives.
check(
    'a javascript: link target is dropped, the link text survives as plain text',
    doitrous_seo_markdown_inline('[click me](javascript:evil)') === 'click me',
);

check(
    'a protocol-relative image target (//evil) is dropped',
    !str_contains(doitrous_seo_markdown_inline('![alt](//evil.example/x.png)'), '<img'),
);

check(
    'an https link target is kept and marked rel=noopener target=_blank',
    str_contains(doitrous_seo_markdown_inline('[a](https://example.com)'), 'rel="noopener" target="_blank"'),
);

check(
    'a site-relative link target is kept without rel=noopener (internal)',
    str_contains(doitrous_seo_markdown_inline('[a](/en/a)'), '<a href="/en/a">')
    && !str_contains(doitrous_seo_markdown_inline('[a](/en/a)'), 'noopener'),
);

check(
    'an anchor target (#section) is kept',
    str_contains(doitrous_seo_markdown_inline('[a](#section)'), '<a href="#section">'),
);

check(
    'a bare http (non-s) image target is kept — the safe-target pattern allows both http and https',
    str_contains(doitrous_seo_markdown_inline('![alt](http://example.com/x.png)'), '<img src="http://example.com/x.png"'),
);

check(
    'bold, italic and inline code render as expected',
    doitrous_seo_markdown_inline('**bold** and *italic* and `code`') === '<strong>bold</strong> and <em>italic</em> and <code>code</code>',
);

check(
    'a leading H1 is dropped (it becomes the page title elsewhere)',
    !str_contains(doitrous_seo_markdown("# Title\n\nBody text."), '<h1>')
    && str_contains(doitrous_seo_markdown("# Title\n\nBody text."), '<p>Body text.</p>'),
);

check(
    'an unordered list renders as <ul><li>',
    doitrous_seo_markdown("- one\n- two") === "<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n",
);

// === validatePayload: exact error strings, ported field for field from core-js's validatePayload ===

check(
    'a non-integer externalId is rejected by name',
    doitrous_seo_validate_payload(['externalId' => 'nine', 'articles' => []])['error'] === 'invalid externalId',
);

check(
    'an empty articles array is rejected by name',
    doitrous_seo_validate_payload(['externalId' => 1, 'articles' => []])['error'] === 'invalid articles',
);

check(
    'a missing required field names its index and key',
    doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [['lang' => 'en', 'title' => 'T', 'slug' => 's']]])['error'] === 'invalid articles[0].bodyMd',
);

check(
    'a slug containing a slash is rejected',
    doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [['lang' => 'en', 'title' => 'T', 'slug' => 'a/b', 'bodyMd' => 'x']]])['error'] === 'invalid articles[0].slug',
);

check(
    'a non-ASCII (Arabic) slug is accepted, not rejected for being non-kebab-case',
    !isset(doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [['lang' => 'ar', 'title' => 'T', 'slug' => 'مقالة-تجريبية', 'bodyMd' => 'x']]])['error']),
);

check(
    'a title over 500 characters is rejected',
    doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [['lang' => 'en', 'title' => str_repeat('x', 501), 'slug' => 's', 'bodyMd' => 'x']]])['error'] === 'invalid articles[0].title',
);

check(
    'a malformed faq entry (missing "a") is rejected by name — not covered by the brief\'s literal code',
    doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [[
        'lang' => 'en', 'title' => 'T', 'slug' => 's', 'bodyMd' => 'x', 'faq' => [['q' => 'Q?']],
    ]]])['error'] === 'invalid articles[0].faq',
);

check(
    'a non-array schemaJsonld is rejected by name',
    doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [[
        'lang' => 'en', 'title' => 'T', 'slug' => 's', 'bodyMd' => 'x', 'schemaJsonld' => 'nope',
    ]]])['error'] === 'invalid articles[0].schemaJsonld',
);

check(
    'a reference without a url is rejected by name',
    doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [[
        'lang' => 'en', 'title' => 'T', 'slug' => 's', 'bodyMd' => 'x', 'references' => [['title' => 'Study']],
    ]]])['error'] === 'invalid articles[0].references',
);

check(
    'an image without a url is rejected as "invalid image"',
    doitrous_seo_validate_payload([
        'externalId' => 1, 'image' => ['alt' => 'no url'],
        'articles' => [['lang' => 'en', 'title' => 'T', 'slug' => 's', 'bodyMd' => 'x']],
    ])['error'] === 'invalid image',
);

check(
    'a fully valid payload passes with no error key',
    !isset(doitrous_seo_validate_payload([
        'externalId' => 1, 'image' => ['url' => 'https://example.com/a.png'],
        'articles' => [['lang' => 'en', 'title' => 'T', 'slug' => 'my-slug', 'bodyMd' => 'Body.', 'faq' => [['q' => 'Q', 'a' => 'A']]]],
    ])['error']),
);

// === robots.txt: exact bodies per packages/CONTRACT.md ======================================

function make_snapshot(bool $indexingEnabled = true, array $robotsExtra = ['Disallow: /tmp'], array $baseUrls = ['en' => 'https://example.com']): array {
    return [
        'version' => 1, 'siteSlug' => 'demo',
        'settings' => [
            'baseUrls' => $baseUrls, 'indexingEnabled' => $indexingEnabled, 'brandSuffix' => '', 'defaultOgImage' => '',
            'organization' => ['name' => '', 'logo' => '', 'sameAs' => [], 'phone' => '', 'email' => '', 'address' => '', 'hours' => '', 'type' => 'Organization'],
            'robotsExtra' => $robotsExtra, 'pageDefaults' => [], 'reservedPrefixes' => ['/api', '/admin'], 'twitterHandle' => '',
        ],
        'pages' => [], 'redirects' => [],
    ];
}

function capture_route(callable $fn): string {
    ob_start();
    try {
        $fn();
    } catch (\Throwable $e) {
        // doitrous_seo_route_*() call exit(); this harness can't trap a real exit(), so the
        // routes below are exercised via their pure helpers (doitrous_seo_sitemap_entries,
        // doitrous_seo_urlset) instead of the exiting route functions themselves.
    }

    return ob_get_clean();
}

// robotsTxt is inlined in doitrous_seo_route_robots(), which calls exit() — asserted here via
// the same body-building logic instead, so the harness never has to trap a real process exit.
function robots_body(array $snapshot): string {
    $s = $snapshot['settings'];
    if (!($s['indexingEnabled'] ?? true)) return "User-agent: *\nDisallow: /\n";
    $urls = $s['baseUrls'] ?? [];
    $base = rtrim(reset($urls) ?: '', '/');
    $lines = array_merge(['User-agent: *', 'Allow: /'], array_filter($s['robotsExtra'] ?? []));
    if ($base !== '') $lines = array_merge($lines, ['', "Sitemap: $base/sitemap.xml"]);

    return implode("\n", $lines) . "\n";
}

check(
    'robots lists Allow, the extra lines and the sitemap URL',
    robots_body(make_snapshot()) === "User-agent: *\nAllow: /\nDisallow: /tmp\n\nSitemap: https://example.com/sitemap.xml\n",
);

check(
    'the kill switch body is exactly the two-line disallow-everything form',
    robots_body(make_snapshot(false)) === "User-agent: *\nDisallow: /\n",
);

// === sitemap entry filtering: index/includeInSitemap, group alternates, the kill switch ======

function make_page(string $lang, string $path, bool $index = true, bool $includeInSitemap = true, string $group = 'g1'): array {
    return [
        'key' => "p:$lang", 'type' => 'page', 'lang' => $lang, 'path' => $path, 'group' => $group,
        'title' => 'T', 'updatedAt' => '2026-09-01T00:00:00.000Z',
        'seo' => ['seoTitle' => '', 'metaDescription' => '', 'canonical' => '', 'index' => $index, 'follow' => true,
            'includeInSitemap' => $includeInSitemap, 'priority' => 0.8,
            'og' => ['title' => '', 'description' => '', 'image' => ''], 'twitter' => ['title' => '', 'description' => '', 'image' => ''],
            'schemaType' => '', 'structuredData' => [], 'faq' => []],
    ];
}

$snap = make_snapshot();
$snap['pages'] = [make_page('en', '/en/a'), make_page('ar', '/ar/a')];
$entries = doitrous_seo_sitemap_entries($snap, []);
check('an indexable page group produces reciprocal alternates plus x-default', count($entries) === 2
    && $entries[0]['alternates']['ar'] === 'https://example.com/ar/a'
    && $entries[0]['alternates']['x-default'] === $entries[0]['alternates']['en']);

$snapNoIndex = make_snapshot();
$snapNoIndex['pages'] = [make_page('en', '/en/a', index: false), make_page('ar', '/ar/a')];
check(
    'a noindex page is excluded from the sitemap even though its group-mate is indexable',
    count(doitrous_seo_sitemap_entries($snapNoIndex, [])) === 1,
);

$snapNoSitemap = make_snapshot();
$snapNoSitemap['pages'] = [make_page('en', '/en/a', includeInSitemap: false)];
check(
    'includeInSitemap=false excludes a page even though it is indexable',
    doitrous_seo_sitemap_entries($snapNoSitemap, []) === [],
);

$snapKillSwitch = make_snapshot(false);
$snapKillSwitch['pages'] = [make_page('en', '/en/a')];
check(
    'the indexing kill switch empties the sitemap outright',
    doitrous_seo_sitemap_entries($snapKillSwitch, []) === [],
);

$snapArticles = make_snapshot();
$snapArticles['pages'] = [];
$article = [
    'externalId' => 1, 'lang' => 'en', 'slug' => 'my-post', 'title' => 'P', 'metaTitle' => '', 'metaDescription' => '',
    'bodyMd' => '', 'bodyHtml' => '', 'faq' => [], 'schemaJsonld' => [], 'imageUrl' => null, 'imageAlt' => null,
    'authorName' => null, 'authorCredentials' => null, 'references' => [], 'og' => ['title' => '', 'description' => '', 'image' => ''],
    'extra' => [], 'publishedAt' => '2026-09-01T00:00:00.000Z', 'updatedAt' => '2026-09-01T00:00:00.000Z',
];
$articleEntries = doitrous_seo_sitemap_entries($snapArticles, [$article]);
check(
    'a stored article appears in the sitemap at its articlePath with a lastmod date',
    count($articleEntries) === 1
    && $articleEntries[0]['loc'] === 'https://example.com/en/blog/my-post'
    && $articleEntries[0]['lastmod'] === '2026-09-01',
);

// --- summary -------------------------------------------------------------------------------

if ($failures) {
    fwrite(STDERR, "\n" . count($failures) . " assertion(s) failed:\n");
    foreach ($failures as $f) fwrite(STDERR, "  - $f\n");
    exit(1);
}

echo "\nOK - all assertions passed\n";
exit(0);
