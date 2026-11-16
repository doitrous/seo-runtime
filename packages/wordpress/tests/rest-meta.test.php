<?php
/**
 * Plain-PHP unit test for the REST meta the hub's WordPress adapter writes and the Polylang
 * language/translations step on rest_after_insert_post. No WordPress or Polylang runtime: the few
 * functions rest-meta.php calls are stubbed below. Run with:
 *
 *   php packages/wordpress/tests/rest-meta.test.php
 *
 * Exits 1 (and prints every failure) if any assertion fails; exits 0 and prints "OK" otherwise.
 */

define('ABSPATH', __DIR__ . '/');

$GLOBALS['__meta'] = [];
$GLOBALS['__registered'] = [];
$GLOBALS['__pll'] = [];

function register_post_meta(string $type, string $key, array $args): bool {
    $GLOBALS['__registered'][$key] = $args;

    return true;
}

function current_user_can(string $cap, ...$args): bool {
    return $cap === 'edit_post' && ($args[0] ?? 0) === 7;
}

function get_post_meta(int $id, string $key, bool $single = false) {
    return $GLOBALS['__meta'][$id][$key] ?? '';
}

require_once __DIR__ . '/../includes/rest-meta.php';

$failures = [];
function check(string $label, bool $ok): void {
    global $failures;
    echo ($ok ? "ok - " : "NOT OK - ") . $label . "\n";
    if (!$ok) $failures[] = $label;
}

// === registration ==========================================================================

doitrous_seo_register_rest_meta();
$reg = $GLOBALS['__registered'];
foreach (['seo_hub_lang', 'seo_hub_translations', 'seo_hub_hreflang', '_yoast_wpseo_title', 'rank_math_description'] as $key) {
    check("$key is registered for REST as a single string", ($reg[$key]['show_in_rest'] ?? false) === true && $reg[$key]['single'] && $reg[$key]['type'] === 'string');
}
check('meta is writable only by someone who can edit that post', $reg['seo_hub_lang']['auth_callback'](false, 'seo_hub_lang', 7) === true
    && $reg['seo_hub_lang']['auth_callback'](false, 'seo_hub_lang', 8) === false);

// === without Polylang ======================================================================

$GLOBALS['__meta'][42] = ['seo_hub_lang' => 'en', 'seo_hub_translations' => '{"en":42,"ar":43}'];
doitrous_seo_apply_polylang((object) ['ID' => 42]);
check('without Polylang the hook is a no-op', $GLOBALS['__pll'] === []);

// === with Polylang (declared only now, so the no-op above really ran without it) ===========

if (true) {
    function pll_languages_list(array $args = []): array { return ['ar', 'en']; }
    function pll_set_post_language($id, $lang): bool { $GLOBALS['__pll'][] = ['lang', $id, $lang]; return true; }
    function pll_save_post_translations(array $arr): array { $GLOBALS['__pll'][] = ['translations', $arr]; return $arr; }
}

// Create: only seo_hub_lang is sent.
$GLOBALS['__pll'] = [];
$GLOBALS['__meta'][44] = ['seo_hub_lang' => 'en'];
doitrous_seo_apply_polylang((object) ['ID' => 44]);
check('a create sets the language and pairs nothing', $GLOBALS['__pll'] === [['lang', 44, 'en']]);

// The hreflang PUT: language from earlier, translations from this request.
$GLOBALS['__pll'] = [];
doitrous_seo_apply_polylang((object) ['ID' => 42]);
check('translations are saved as {lang: int id} after the language', $GLOBALS['__pll'] === [['lang', 42, 'en'], ['translations', ['en' => 42, 'ar' => 43]]]);

// A language Polylang does not have is never assigned or paired.
$GLOBALS['__pll'] = [];
$GLOBALS['__meta'][45] = ['seo_hub_lang' => 'fr', 'seo_hub_translations' => '{"fr":45,"en":46}'];
doitrous_seo_apply_polylang((object) ['ID' => 45]);
check('an unknown language is ignored, and a one-language group is not saved', $GLOBALS['__pll'] === []);

// A post the hub never wrote (no meta) is left alone.
$GLOBALS['__pll'] = [];
doitrous_seo_apply_polylang((object) ['ID' => 99]);
check('a post without hub meta is left alone', $GLOBALS['__pll'] === []);

if ($failures) {
    fwrite(STDERR, "\n" . count($failures) . " assertion(s) failed:\n");
    foreach ($failures as $f) fwrite(STDERR, "  - $f\n");
    exit(1);
}

echo "\nOK - all assertions passed\n";
exit(0);
