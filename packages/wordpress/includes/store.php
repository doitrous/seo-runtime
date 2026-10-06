<?php

if (!defined('ABSPATH')) exit;

function doitrous_seo_articles_table(): string {
    global $wpdb;

    return $wpdb->prefix . 'seo_runtime_articles';
}

/**
 * Snapshot, hits and last-sync live in options; articles need a table (they are many). Columns
 * mirror packages/core-js/src/migrations/mysql.sql's seo_runtime_articles field for field — the
 * page-key naming rule applies here too, so no column collides with a MySQL reserved word.
 */
function doitrous_seo_install(): void {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    // An existing 0.1.x table is re-keyed first: dbDelta adds columns but cannot move a primary key.
    doitrous_seo_upgrade_articles_table();
    $table = doitrous_seo_articles_table();
    $charset = $wpdb->get_charset_collate();
    dbDelta("CREATE TABLE $table (
        external_id BIGINT UNSIGNED NOT NULL,
        lang VARCHAR(16) NOT NULL,
        slug VARCHAR(191) NOT NULL,
        title VARCHAR(500) NOT NULL,
        meta_title VARCHAR(500) NOT NULL DEFAULT '',
        meta_description VARCHAR(1000) NOT NULL DEFAULT '',
        body_md MEDIUMTEXT NOT NULL,
        body_html MEDIUMTEXT NOT NULL,
        faq LONGTEXT NOT NULL,
        schema_jsonld LONGTEXT NOT NULL,
        image_url VARCHAR(2000) NOT NULL DEFAULT '',
        image_alt VARCHAR(500) NOT NULL DEFAULT '',
        author_name VARCHAR(500) NOT NULL DEFAULT '',
        author_credentials VARCHAR(500) NOT NULL DEFAULT '',
        refs LONGTEXT NOT NULL,
        og LONGTEXT NOT NULL,
        extra LONGTEXT NOT NULL,
        published_at VARCHAR(40) NOT NULL DEFAULT '',
        updated_at VARCHAR(40) NOT NULL DEFAULT '',
        locale VARCHAR(35) NOT NULL DEFAULT '',
        is_lead TINYINT(1) NOT NULL DEFAULT 1,
        hreflang LONGTEXT NULL,
        PRIMARY KEY  (external_id, locale),
        KEY lang_slug (lang, slug),
        KEY locale_slug (locale, slug)
    ) $charset;");
    update_option('doitrous_seo_db_version', DOITROUS_SEO_DB_VERSION);
}

/** Bumped when the articles table changes shape. 2 = 0.2.0, per-country pages. */
const DOITROUS_SEO_DB_VERSION = 2;

/** `plugins_loaded`: plugin updates never re-run the activation hook, so the schema is checked here. */
function doitrous_seo_maybe_upgrade_db(): void {
    if ((int) get_option('doitrous_seo_db_version', 0) >= DOITROUS_SEO_DB_VERSION) return;
    doitrous_seo_install();
}

/**
 * 0.1.x → 0.2.0: add `locale` (backfilled with `lang`), `is_lead` (every 0.1.x row was the only
 * version of its language, so 1) and `hreflang`, then re-key from (external_id, lang) to
 * (external_id, locale). Existing articles keep their URLs. A no-op on a fresh install or an
 * already upgraded table.
 */
function doitrous_seo_upgrade_articles_table(): void {
    global $wpdb;
    $table = doitrous_seo_articles_table();
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) !== $table) return;
    if ($wpdb->get_var("SHOW COLUMNS FROM $table LIKE 'locale'")) return;
    $wpdb->query("ALTER TABLE $table ADD COLUMN locale VARCHAR(35) NOT NULL DEFAULT '', ADD COLUMN is_lead TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN hreflang LONGTEXT NULL");
    $wpdb->query("UPDATE $table SET locale = lang WHERE locale = ''");
    $wpdb->query("ALTER TABLE $table DROP PRIMARY KEY, ADD PRIMARY KEY (external_id, locale), ADD KEY locale_slug (locale, slug)");
}

function doitrous_seo_get_snapshot(): ?array {
    $s = get_option('doitrous_seo_snapshot', null);

    return is_array($s) ? $s : null;
}

/** One value, not the whole snapshot — this is what resolve() reads on every render. */
function doitrous_seo_get_settings(): ?array {
    return doitrous_seo_get_snapshot()['settings'] ?? null;
}

function doitrous_seo_put_snapshot(array $s): void {
    // autoload = 'no': the snapshot is read on render through the object cache, not on every
    // admin page load.
    update_option('doitrous_seo_snapshot', $s, false);
    update_option('doitrous_seo_last_sync', gmdate('c'), false);
}

function doitrous_seo_get_page(string $path, string $lang): ?array {
    $p = doitrous_seo_normalize_path($path);
    foreach (doitrous_seo_get_snapshot()['pages'] ?? [] as $page) {
        if ($page['lang'] === $lang && doitrous_seo_normalize_path($page['path']) === $p) return $page;
    }

    return null;
}

function doitrous_seo_list_group(string $groupKey): array {
    if ($groupKey === '') return [];

    return array_values(array_filter(
        doitrous_seo_get_snapshot()['pages'] ?? [],
        fn ($p) => $p['group'] === $groupKey,
    ));
}

function doitrous_seo_get_redirect(string $path): ?array {
    $p = doitrous_seo_normalize_path($path);
    foreach (doitrous_seo_get_snapshot()['redirects'] ?? [] as $r) {
        if (!empty($r['active']) && doitrous_seo_normalize_path($r['source']) === $p) return $r;
    }

    return null;
}

/** Row -> the same field names core-js's StoredArticle uses, so articles.php (B12b) needs no map. */
function doitrous_seo_row_to_article(object $r): array {
    return [
        'externalId' => (int) $r->external_id, 'lang' => $r->lang, 'slug' => $r->slug,
        'title' => $r->title, 'metaTitle' => $r->meta_title, 'metaDescription' => $r->meta_description,
        'bodyMd' => $r->body_md, 'bodyHtml' => $r->body_html,
        'faq' => json_decode($r->faq, true) ?: [], 'schemaJsonld' => json_decode($r->schema_jsonld, true) ?: [],
        'imageUrl' => $r->image_url !== '' ? $r->image_url : null,
        'imageAlt' => $r->image_alt !== '' ? $r->image_alt : null,
        'authorName' => $r->author_name !== '' ? $r->author_name : null,
        'authorCredentials' => $r->author_credentials !== '' ? $r->author_credentials : null,
        'references' => json_decode($r->refs, true) ?: [],
        'og' => json_decode($r->og, true) ?: ['title' => '', 'description' => '', 'image' => ''],
        'extra' => json_decode($r->extra, true) ?: [],
        'publishedAt' => $r->published_at, 'updatedAt' => $r->updated_at,
        // 0.2.0. A row upgraded from 0.1.x has locale = lang, is_lead = 1 and no hreflang.
        'locale' => (string) ($r->locale ?? '') !== '' ? (string) $r->locale : $r->lang,
        'lead' => (int) ($r->is_lead ?? 1) !== 0,
        'hreflang' => json_decode((string) ($r->hreflang ?? ''), true) ?: [],
    ];
}

function doitrous_seo_list_articles(?string $lang = null): array {
    global $wpdb;
    $table = doitrous_seo_articles_table();
    $rows = $lang === null
        ? $wpdb->get_results("SELECT * FROM $table")
        : $wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE lang = %s", $lang));

    return array_map('doitrous_seo_row_to_article', $rows ?: []);
}

/** Every stored version of one externalId (0.2.0). */
function doitrous_seo_list_article_versions(int $externalId): array {
    global $wpdb;
    $table = doitrous_seo_articles_table();

    return array_map('doitrous_seo_row_to_article', $wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE external_id = %d", $externalId)) ?: []);
}

/**
 * Lookup and the 409's collision check. A plain language (`ar`) resolves to that language's
 * lead; a locale (`ar-AE`, `ar-ae`) to the version stored under it. The lead is tried first, so
 * a region-coded site language (`pt-BR`) still resolves. Themes route through
 * `doitrous_seo_get_article()`, which also refuses a lead requested by its locale.
 */
function doitrous_seo_find_article_by_slug(string $langOrLocale, string $slug): ?array {
    global $wpdb;
    $table = doitrous_seo_articles_table();
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE slug = %s AND is_lead = 1 AND LOWER(lang) = %s", $slug, strtolower($langOrLocale)))
        ?: $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE slug = %s AND locale = %s", $slug, doitrous_seo_canonical_locale($langOrLocale)));

    return $row ? doitrous_seo_row_to_article($row) : null;
}

/**
 * Keyed by (external_id, locale). A lead instead replaces its language's lead whatever that
 * row's locale (a 0.1.x row keyed by language is updated in place, never duplicated, when the
 * hub starts sending `locale`) and absorbs a non-lead row stored under its locale.
 */
function doitrous_seo_upsert_article(array $a): array {
    global $wpdb;
    $table = doitrous_seo_articles_table();
    $locale = doitrous_seo_locale_of($a);
    $lead = doitrous_seo_is_lead($a);
    if ($lead) {
        $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE external_id = %d AND locale = %s AND is_lead = 0", $a['externalId'], $locale));
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT published_at, locale FROM $table WHERE external_id = %d AND lang = %s AND is_lead = 1", $a['externalId'], $a['lang'],
        ));
    } else {
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT published_at, locale FROM $table WHERE external_id = %d AND locale = %s AND is_lead = 0", $a['externalId'], $locale,
        ));
    }
    $a['publishedAt'] = $existing ? $existing->published_at : $a['publishedAt'];
    // A lead whose locale changes (0.1.x `ar` → `ar-SA`) sits under its old key; drop that row
    // first so the replace below lands on (external_id, new locale) without a stray duplicate.
    if ($existing && (string) $existing->locale !== $locale) {
        $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE external_id = %d AND locale = %s", $a['externalId'], (string) $existing->locale));
    }
    $wpdb->replace($table, [
        'external_id' => $a['externalId'], 'lang' => $a['lang'], 'slug' => $a['slug'], 'title' => $a['title'],
        'meta_title' => $a['metaTitle'], 'meta_description' => $a['metaDescription'],
        'body_md' => $a['bodyMd'], 'body_html' => $a['bodyHtml'],
        'faq' => wp_json_encode($a['faq'] ?? []), 'schema_jsonld' => wp_json_encode($a['schemaJsonld'] ?? []),
        'image_url' => $a['imageUrl'] ?? '', 'image_alt' => $a['imageAlt'] ?? '',
        'author_name' => $a['authorName'] ?? '', 'author_credentials' => $a['authorCredentials'] ?? '',
        // References, OG and the spec-1 extras round-trip as JSON rather than as ten more columns.
        'refs' => wp_json_encode($a['references'] ?? []),
        'og' => wp_json_encode($a['og'] ?? ['title' => '', 'description' => '', 'image' => '']),
        'extra' => wp_json_encode($a['extra'] ?? []),
        'published_at' => $a['publishedAt'], 'updated_at' => $a['updatedAt'],
        'locale' => $locale, 'is_lead' => $lead ? 1 : 0,
        'hreflang' => wp_json_encode((object) ($a['hreflang'] ?? [])),
    ]);

    return array_merge($a, ['locale' => $locale, 'lead' => $lead]);
}

function doitrous_seo_increment_hit(string $source): void {
    $hits = get_option('doitrous_seo_hits', []);
    $key = doitrous_seo_normalize_path($source);
    $hits[$key] = (int) ($hits[$key] ?? 0) + 1;
    update_option('doitrous_seo_hits', $hits, false);
}

/** Read-only: GET /api/seo/health must not mutate. */
function doitrous_seo_peek_hits(): array {
    $out = [];
    foreach ((array) get_option('doitrous_seo_hits', []) as $source => $hits) {
        if ((int) $hits > 0) $out[] = ['source' => $source, 'hits' => (int) $hits];
    }

    return $out;
}

/** Subtracts what the hub acknowledged, so hits counted mid-request are not lost. */
function doitrous_seo_take_hits(array $reported): void {
    $hits = (array) get_option('doitrous_seo_hits', []);
    foreach ($reported as $hit) {
        $key = $hit['source'];
        $hits[$key] = max(0, (int) ($hits[$key] ?? 0) - (int) $hit['hits']);
    }
    update_option('doitrous_seo_hits', $hits, false);
}

function doitrous_seo_last_sync(): ?string {
    $v = get_option('doitrous_seo_last_sync', '');

    return $v === '' ? null : (string) $v;
}
