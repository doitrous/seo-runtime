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
        PRIMARY KEY  (external_id, lang),
        KEY lang_slug (lang, slug)
    ) $charset;");
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

function doitrous_seo_find_article_by_slug(string $lang, string $slug): ?array {
    global $wpdb;
    $table = doitrous_seo_articles_table();
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE lang = %s AND slug = %s", $lang, $slug));

    return $row ? doitrous_seo_row_to_article($row) : null;
}

function doitrous_seo_upsert_article(array $a): array {
    global $wpdb;
    $table = doitrous_seo_articles_table();
    $existing = $wpdb->get_row($wpdb->prepare(
        "SELECT published_at FROM $table WHERE external_id = %d AND lang = %s", $a['externalId'], $a['lang'],
    ));
    $a['publishedAt'] = $existing ? $existing->published_at : $a['publishedAt'];
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
    ]);

    return $a;
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
