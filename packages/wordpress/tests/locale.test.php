<?php
/**
 * Plain-PHP unit test for per-country pages (0.2.0, hub contract 1.20.0): locale ingest, the
 * (external_id, locale) store, lookup by locale or language, hreflang and the sitemap, and the
 * 0.1.x → 0.2.0 backfill. No WordPress runtime: `$wpdb` is a tiny fake over an in-memory SQLite
 * (PDO) database. Run with:
 *
 *   php packages/wordpress/tests/locale.test.php
 */

define('ABSPATH', __DIR__ . '/');

$GLOBALS['__wp_options'] = [];
function get_option(string $key, $default = false) { return $GLOBALS['__wp_options'][$key] ?? $default; }
function update_option(string $key, $value, $autoload = null): bool { $GLOBALS['__wp_options'][$key] = $value; return true; }
function apply_filters(string $tag, $value, ...$args) { return $value; }
function add_filter(...$args): bool { return true; }
function esc_attr(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function esc_html(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function esc_url(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function wp_json_encode($data, int $options = 0): string|false { return json_encode($data, $options); }
function wp_kses_post(string $html): string { return $html; }
function is_admin(): bool { return false; }
function doitrous_seo_article_path(string $lang, string $slug): string { return "/$lang/blog/$slug"; }

/** Just the $wpdb surface store.php's article functions use, over SQLite. */
class FakeWpdb
{
    public string $prefix = 'wp_';
    public PDO $pdo;

    public function __construct() { $this->pdo = new PDO('sqlite::memory:'); $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); }

    public function prepare(string $q, ...$args): string
    {
        $i = 0;

        return preg_replace_callback('/%[sd]/', function ($m) use (&$i, $args) {
            $v = $args[$i++];

            return $m[0] === '%d' ? (string) (int) $v : $this->pdo->quote((string) $v);
        }, $q);
    }

    public function get_results(string $q): array { return $this->pdo->query($q)->fetchAll(PDO::FETCH_OBJ); }
    public function get_row(string $q): ?object { return $this->get_results($q)[0] ?? null; }
    public function query(string $q): int { return $this->pdo->exec($q); }

    public function replace(string $table, array $data): void
    {
        $cols = implode(', ', array_keys($data));
        $vals = implode(', ', array_map(fn ($v) => $v === null ? 'NULL' : $this->pdo->quote((string) $v), array_values($data)));
        $this->pdo->exec("REPLACE INTO $table ($cols) VALUES ($vals)");
    }
}

$wpdb = new FakeWpdb();
// The 0.1.6 table shape (SQLite spelling) — the 0.2.0 shape is reached by the same backfill the
// MySQL upgrade performs, so the old row below is read exactly as an upgraded one.
$wpdb->query("CREATE TABLE wp_seo_runtime_articles (
    external_id INTEGER NOT NULL, lang TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
    meta_title TEXT NOT NULL DEFAULT '', meta_description TEXT NOT NULL DEFAULT '',
    body_md TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '', faq TEXT NOT NULL DEFAULT '[]',
    schema_jsonld TEXT NOT NULL DEFAULT '[]', image_url TEXT NOT NULL DEFAULT '', image_alt TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL DEFAULT '', author_credentials TEXT NOT NULL DEFAULT '', refs TEXT NOT NULL DEFAULT '[]',
    og TEXT NOT NULL DEFAULT '{}', extra TEXT NOT NULL DEFAULT '{}',
    published_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (external_id, lang))");
$wpdb->query("INSERT INTO wp_seo_runtime_articles (external_id, lang, slug, title, published_at) VALUES (5, 'ar', 'old', 'Old', '2026-01-01T00:00:00+00:00')");
// What doitrous_seo_upgrade_articles_table() does on MySQL, in SQLite terms.
$wpdb->query("CREATE TABLE wp_new AS SELECT *, lang AS locale, 1 AS is_lead, NULL AS hreflang FROM wp_seo_runtime_articles");
$wpdb->query('DROP TABLE wp_seo_runtime_articles');
$wpdb->query("CREATE TABLE wp_seo_runtime_articles (
    external_id INTEGER NOT NULL, lang TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
    meta_title TEXT NOT NULL DEFAULT '', meta_description TEXT NOT NULL DEFAULT '',
    body_md TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '', faq TEXT NOT NULL DEFAULT '[]',
    schema_jsonld TEXT NOT NULL DEFAULT '[]', image_url TEXT NOT NULL DEFAULT '', image_alt TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL DEFAULT '', author_credentials TEXT NOT NULL DEFAULT '', refs TEXT NOT NULL DEFAULT '[]',
    og TEXT NOT NULL DEFAULT '{}', extra TEXT NOT NULL DEFAULT '{}',
    published_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL DEFAULT '', is_lead INTEGER NOT NULL DEFAULT 1, hreflang TEXT NULL,
    PRIMARY KEY (external_id, locale))");
$wpdb->query('INSERT INTO wp_seo_runtime_articles SELECT * FROM wp_new');

require_once __DIR__ . '/../includes/store.php';
require_once __DIR__ . '/../includes/locale.php';
require_once __DIR__ . '/../includes/resolve.php';
require_once __DIR__ . '/../includes/sitemap.php';
require_once __DIR__ . '/../includes/articles.php';

$failures = [];
function check(string $label, bool $ok): void {
    global $failures;
    echo ($ok ? "ok - " : "NOT OK - ") . $label . "\n";
    if (!$ok) $failures[] = $label;
}

$settings = ['baseUrls' => ['en' => 'https://x.com', 'ar' => 'https://x.com']] + DOITROUS_SEO_EMPTY_SETTINGS;
update_option('doitrous_seo_snapshot', ['version' => 1, 'siteSlug' => 'demo', 'settings' => $settings, 'pages' => [], 'redirects' => []]);
$item = fn (string $lang, ?string $locale, string $slug = 'x', ?string $title = null) =>
    ['lang' => $lang, 'title' => $title ?? 'T ' . ($locale ?? $lang), 'slug' => $slug, 'bodyMd' => "# T\n\nBody."]
    + ($locale !== null ? ['locale' => $locale] : []);

// === helpers ===============================================================================

check('canonical locale', doitrous_seo_canonical_locale('ar_ae') === 'ar-AE');
check('localize path swaps the language segment', doitrous_seo_localize_path('/ar/blog/x', 'ar', 'ar-AE') === '/ar-ae/blog/x');
check('localize path prepends to an unprefixed language', doitrous_seo_localize_path('https://x.com/blog/x', 'en', 'en-US') === 'https://x.com/en-us/blog/x');
check('parse prefix of a locale', doitrous_seo_parse_locale_prefix('/ar-ae/blog/x') === ['segment' => 'ar-ae', 'lang' => 'ar', 'locale' => 'ar-AE', 'rest' => '/blog/x']);
check('parse prefix refuses a non-language', doitrous_seo_parse_locale_prefix('/blog/x') === null);

// === upgraded 0.1.x row =====================================================================

$old = doitrous_seo_find_article_by_slug('ar', 'old');
check('an upgraded 0.1.x row reads back with locale = lang and lead', $old !== null && $old['locale'] === 'ar' && $old['lead'] === true && $old['hreflang'] === []);
check('an upgraded 0.1.x row is found through the theme lookup', (doitrous_seo_get_article('ar', 'old')['title'] ?? null) === 'Old');

// === 0.1.6-shaped payload ===================================================================

$out = doitrous_seo_ingest(['externalId' => 9, 'articles' => [$item('en', null), $item('ar', null)]], ['en', 'ar']);
check('a payload without locale answers exactly as 0.1.6', $out === ['status' => 200, 'body' => ['results' => [
    ['lang' => 'en', 'remoteId' => '9:en', 'remoteUrl' => 'https://x.com/en/blog/x'],
    ['lang' => 'ar', 'remoteId' => '9:ar', 'remoteUrl' => 'https://x.com/ar/blog/x'],
], 'skipped' => []]]);

// === locale payload: the 0.1.x rows of job 9 are taken over in place ======================

$out = doitrous_seo_ingest(['externalId' => 9, 'articles' => [
    $item('en', 'en-US'), $item('ar', 'ar-SA'), $item('ar', 'ar-AE'),
]], ['en', 'ar']);
check('locale results carry locale, lead keeps the language URL', $out['status'] === 200 && $out['body']['results'] === [
    ['lang' => 'en', 'locale' => 'en-US', 'remoteId' => '9:en', 'remoteUrl' => 'https://x.com/en/blog/x'],
    ['lang' => 'ar', 'locale' => 'ar-SA', 'remoteId' => '9:ar', 'remoteUrl' => 'https://x.com/ar/blog/x'],
    ['lang' => 'ar', 'locale' => 'ar-AE', 'remoteId' => '9:ar-AE', 'remoteUrl' => 'https://x.com/ar-ae/blog/x'],
]);
$versions = doitrous_seo_list_article_versions(9);
check('job 9 now has exactly three versions (no duplicate of the 0.1.x rows)', count($versions) === 3);
$expected = [
    'en-US' => 'https://x.com/en/blog/x', 'ar-SA' => 'https://x.com/ar/blog/x', 'ar-AE' => 'https://x.com/ar-ae/blog/x',
    'en' => 'https://x.com/en/blog/x', 'ar' => 'https://x.com/ar/blog/x', 'x-default' => 'https://x.com/en/blog/x',
];
$allHreflang = true;
foreach ($versions as $v) if ($v['hreflang'] != $expected) $allHreflang = false;
check('every version stores the full hreflang set', $allHreflang);
check('lookup by locale', (doitrous_seo_get_article('ar-ae', 'x')['title'] ?? null) === 'T ar-AE');
check('lookup by language returns the lead', (doitrous_seo_get_article('ar', 'x')['title'] ?? null) === 'T ar-SA');
check('the lead is not served at its locale URL', doitrous_seo_get_article('ar-sa', 'x') === null);

$entries = doitrous_seo_sitemap_entries(['settings' => $settings, 'pages' => []], doitrous_seo_list_articles());
$locs = array_column($entries, 'loc');
sort($locs);
check('the sitemap lists one url per version', $locs === ['https://x.com/ar-ae/blog/x', 'https://x.com/ar/blog/old', 'https://x.com/ar/blog/x', 'https://x.com/en/blog/x']);
$ae = array_values(array_filter($entries, fn ($e) => $e['loc'] === 'https://x.com/ar-ae/blog/x'))[0];
check('a locale url carries the full alternates with x-default = the source', $ae['alternates'] == $expected);

// === slug clash per locale ==================================================================

check('another job may reuse a slug only stored under a locale, as its lead', doitrous_seo_ingest(['externalId' => 10, 'articles' => [$item('ar', 'ar-SA', 'y'), $item('ar', 'ar-AE', 'b')]], ['ar'])['status'] === 200
    && doitrous_seo_ingest(['externalId' => 11, 'articles' => [$item('ar', 'ar-SA', 'b')]], ['ar'])['status'] === 200);
check('but not under the same locale', doitrous_seo_ingest(['externalId' => 12, 'articles' => [$item('ar', 'ar-SA', 'c'), $item('ar', 'ar-AE', 'b')]], ['ar'])
    === ['status' => 409, 'body' => ['error' => 'slug_taken', 'slug' => 'b', 'lang' => 'ar', 'locale' => 'ar-AE']]);
check('a locale of another language is a 400', doitrous_seo_validate_payload(['externalId' => 1, 'articles' => [$item('ar', 'en-US')]]) === ['error' => 'invalid articles[0].locale']);

if ($failures) {
    echo "\n" . count($failures) . " failure(s)\n";
    exit(1);
}
echo "\nOK - all assertions passed\n";
