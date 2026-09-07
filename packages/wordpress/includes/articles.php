<?php

if (!defined('ABSPATH')) exit;

/**
 * Rejected only when the slug cannot sit in a URL path segment — not kebab-case-only: the fleet
 * serves Arabic slugs and the hub has been sending them since spec 1.
 */
function doitrous_seo_bad_slug(string $slug): bool {
    return $slug === '' || mb_strlen($slug) > 191
        || preg_match('#[\s/\\\\?\#]#u', $slug) === 1
        || str_contains($slug, '..');
}

/** Matches core-js's `str`: a non-empty string once trimmed. */
function doitrous_seo_str(mixed $v): bool {
    return is_string($v) && trim($v) !== '';
}

/**
 * Ports core-js's validatePayload field for field, including the faq/schemaJsonld/references/
 * image checks the brief's literal code omitted (controller ruling: validate exactly like core,
 * same error strings) — every message below is the exact string `articles.ts` returns.
 */
function doitrous_seo_validate_payload(mixed $body): array {
    if (!is_array($body) || !is_int($body['externalId'] ?? null)) return ['error' => 'invalid externalId'];
    if (!is_array($body['articles'] ?? null) || !$body['articles']) return ['error' => 'invalid articles'];
    foreach (array_values($body['articles']) as $i => $a) {
        if (!is_array($a)) $a = [];
        foreach (['lang', 'title', 'slug', 'bodyMd'] as $k) {
            if (!doitrous_seo_str($a[$k] ?? null)) return ['error' => "invalid articles[$i].$k"];
        }
        if (doitrous_seo_bad_slug(trim($a['slug']))) return ['error' => "invalid articles[$i].slug"];
        if (mb_strlen($a['title']) > 500) return ['error' => "invalid articles[$i].title"];
        if (array_key_exists('faq', $a)) {
            $ok = is_array($a['faq']);
            if ($ok) foreach ($a['faq'] as $f) {
                if (!is_array($f) || !doitrous_seo_str($f['q'] ?? null) || !doitrous_seo_str($f['a'] ?? null)) { $ok = false; break; }
            }
            if (!$ok) return ['error' => "invalid articles[$i].faq"];
        }
        if (array_key_exists('schemaJsonld', $a) && !is_array($a['schemaJsonld'])) return ['error' => "invalid articles[$i].schemaJsonld"];
        if (array_key_exists('references', $a)) {
            $ok = is_array($a['references']);
            if ($ok) foreach ($a['references'] as $r) {
                if (!is_array($r) || !doitrous_seo_str($r['url'] ?? null)) { $ok = false; break; }
            }
            if (!$ok) return ['error' => "invalid articles[$i].references"];
        }
    }
    if (($body['image'] ?? null) !== null) {
        if (!is_array($body['image']) || !doitrous_seo_str($body['image']['url'] ?? null)) return ['error' => 'invalid image'];
    }

    return ['payload' => $body];
}

/**
 * The one hand-rolled parser in the system: WordPress ships no markdown renderer and the plan
 * adds no dependency. A deliberate CommonMark SUBSET — ATX headings, paragraphs, unordered and
 * ordered lists, fenced and inline code, links, images, bold and italic. Anything outside the
 * subset is emitted as escaped text, never as markup, and `wp_kses_post` is the second line of
 * defence over whatever this produces.
 *
 * ponytail: line-based, no inline parser nesting beyond the four patterns below. If an article
 * ever needs tables or blockquotes, add them here rather than reaching for a dependency.
 */
function doitrous_seo_markdown(string $md): string {
    $md = (string) preg_replace('/^\s*# .*\n?/', '', $md, 1);   // the leading H1 is the page title
    $lines = preg_split('/\r?\n/', $md);
    $html = '';
    $paragraph = [];
    $list = null;          // 'ul' | 'ol' | null
    $code = false;

    $flushParagraph = function () use (&$paragraph, &$html) {
        if ($paragraph) {
            $html .= '<p>' . doitrous_seo_markdown_inline(implode(' ', $paragraph)) . "</p>\n";
            $paragraph = [];
        }
    };
    $closeList = function () use (&$list, &$html) {
        if ($list) { $html .= "</$list>\n"; $list = null; }
    };

    foreach ($lines as $line) {
        if (preg_match('/^```/', $line)) {
            $flushParagraph(); $closeList();
            $html .= $code ? "</code></pre>\n" : '<pre><code>';
            $code = !$code;
            continue;
        }
        if ($code) { $html .= esc_html($line) . "\n"; continue; }

        $trimmed = trim($line);
        if ($trimmed === '') { $flushParagraph(); $closeList(); continue; }

        if (preg_match('/^(#{2,6})\s+(.*)$/', $trimmed, $m)) {
            $flushParagraph(); $closeList();
            $level = strlen($m[1]);
            $html .= "<h$level>" . doitrous_seo_markdown_inline($m[2]) . "</h$level>\n";
            continue;
        }
        if (preg_match('/^[-*]\s+(.*)$/', $trimmed, $m)) {
            $flushParagraph();
            if ($list !== 'ul') { $closeList(); $html .= "<ul>\n"; $list = 'ul'; }
            $html .= '<li>' . doitrous_seo_markdown_inline($m[1]) . "</li>\n";
            continue;
        }
        if (preg_match('/^\d+\.\s+(.*)$/', $trimmed, $m)) {
            $flushParagraph();
            if ($list !== 'ol') { $closeList(); $html .= "<ol>\n"; $list = 'ol'; }
            $html .= '<li>' . doitrous_seo_markdown_inline($m[1]) . "</li>\n";
            continue;
        }
        $closeList();
        $paragraph[] = $trimmed;
    }
    $flushParagraph();
    $closeList();
    if ($code) $html .= "</code></pre>\n";

    return $html;
}

/** Only http(s), site-relative and anchor targets become links or images. */
function doitrous_seo_safe_target(string $target): bool {
    return preg_match('#^(https?://|/(?!/)|\#)#i', trim($target)) === 1;
}

// ponytail: the link/image target group ([^)\s>]+) stops at the first ')', so a URL that itself
// contains a literal paren (rare outside of query strings) truncates early instead of matching
// CommonMark's real balanced-paren destination rule; upgrade to a small paren-depth counter if a
// site ever needs that, but no hub-sent article has hit it as of spec 1.
function doitrous_seo_markdown_inline(string $text): string {
    // Escape FIRST: every byte of the source is text unless one of the four patterns below
    // turns it into markup. That is what makes `<scr<script>ipt>` impossible to smuggle through.
    $out = esc_html($text);
    $out = preg_replace_callback('/!\[([^\]]*)\]\(<?([^)\s>]+)>?\)/', function ($m) {
        $target = html_entity_decode($m[2], ENT_QUOTES);

        return doitrous_seo_safe_target($target)
            ? '<img src="' . esc_url($target) . '" alt="' . esc_attr(html_entity_decode($m[1], ENT_QUOTES)) . '">'
            : esc_html($m[1]);
    }, $out);
    $out = preg_replace_callback('/\[([^\]]+)\]\(<?([^)\s>]+)>?\)/', function ($m) {
        $target = html_entity_decode($m[2], ENT_QUOTES);
        if (!doitrous_seo_safe_target($target)) return $m[1];
        $external = preg_match('#^https?://#i', $target) === 1;

        return '<a href="' . esc_url($target) . '"' . ($external ? ' rel="noopener" target="_blank"' : '') . '>' . $m[1] . '</a>';
    }, $out);
    $out = (string) preg_replace('/`([^`]+)`/', '<code>$1</code>', $out);
    $out = (string) preg_replace('/\*\*([^*]+)\*\*/', '<strong>$1</strong>', $out);
    $out = (string) preg_replace('/(?<!\*)\*([^*]+)\*(?!\*)/', '<em>$1</em>', $out);

    return $out;
}

function doitrous_seo_intro(string $md): string {
    $body = (string) preg_replace('/^\s*# .*\n?/', '', $md, 1);
    foreach (preg_split('/\n{2,}/', $body) as $block) {
        $p = trim($block);
        if ($p === '' || str_starts_with($p, '#')) continue;
        $p = (string) preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $p);

        return trim(str_replace(['*', '_', '`'], '', $p));
    }

    return '';
}

function doitrous_seo_clip(string $text, int $max): string {
    $t = trim($text);
    if (mb_strlen($t) <= $max) return $t;
    $cut = mb_substr($t, 0, $max);
    $space = mb_strrpos($cut, ' ');

    return rtrim($space !== false && $space > $max * 0.6 ? mb_substr($cut, 0, $space) : $cut, " ,;:.-");
}

function doitrous_seo_to_rows(array $payload, array $supported): array {
    $skipped = [];
    $rows = [];
    $now = gmdate('c');
    foreach ($payload['articles'] as $a) {
        if (!in_array($a['lang'], $supported, true)) { $skipped[] = $a['lang']; continue; }
        $lede = trim($a['introduction'] ?? '') ?: doitrous_seo_intro($a['bodyMd']);
        $rows[] = [
            'externalId' => $payload['externalId'], 'lang' => $a['lang'], 'slug' => trim($a['slug']),
            'title' => $a['title'],
            'metaTitle' => trim($a['metaTitle'] ?? '') ?: $a['title'],
            'metaDescription' => trim($a['metaDescription'] ?? '') ?: doitrous_seo_clip($lede, 155),
            'bodyMd' => $a['bodyMd'],
            // wp_kses_post is the second line of defence over the subset parser's output.
            'bodyHtml' => wp_kses_post(doitrous_seo_markdown($a['bodyMd'])),
            'faq' => $a['faq'] ?? [], 'schemaJsonld' => $a['schemaJsonld'] ?? [],
            'imageUrl' => $payload['image']['url'] ?? null, 'imageAlt' => $payload['image']['alt'] ?? null,
            'authorName' => $payload['author']['name'] ?? null,
            'authorCredentials' => $payload['author']['credentials'] ?? null,
            'references' => $a['references'] ?? [],
            'og' => ['title' => $a['og']['title'] ?? '', 'description' => $a['og']['description'] ?? '', 'image' => $payload['image']['url'] ?? ''],
            'extra' => array_filter([
                'reviewer' => $payload['reviewer'] ?? null, 'reviewedAt' => $payload['reviewedAt'] ?? null,
                'checklist' => $payload['checklist'] ?? null, 'cta' => $payload['cta'] ?? null,
                'plannedUpdateAt' => $payload['plannedUpdateAt'] ?? null,
                'secondaryKeywords' => $a['secondaryKeywords'] ?? null, 'searchIntent' => $a['searchIntent'] ?? null,
                'sections' => $a['sections'] ?? null, 'introduction' => $a['introduction'] ?? null,
            ], fn ($v) => $v !== null),
            'publishedAt' => $now, 'updatedAt' => $now,
        ];
    }

    return ['skipped' => $skipped, 'articles' => $rows];
}

function doitrous_seo_route_articles(): void {
    $v = doitrous_seo_validate_payload(doitrous_seo_read_body());
    if (isset($v['error'])) doitrous_seo_json(['error' => $v['error']], 400);

    $supported = (array) apply_filters('doitrous_seo_supported_languages', [doitrous_seo_site_lang()]);
    ['skipped' => $skipped, 'articles' => $rows] = doitrous_seo_to_rows($v['payload'], $supported);
    if (!$rows) doitrous_seo_json(['error' => 'no supported languages'], 400);

    foreach ($rows as $row) {
        $clash = doitrous_seo_find_article_by_slug($row['lang'], $row['slug']);
        if ($clash && $clash['externalId'] !== $row['externalId']) {
            doitrous_seo_json(['error' => 'slug_taken', 'slug' => $row['slug'], 'lang' => $row['lang']], 409);
        }
    }

    $settings = doitrous_seo_get_settings() ?? DOITROUS_SEO_EMPTY_SETTINGS;
    $results = [];
    foreach ($rows as $row) {
        doitrous_seo_upsert_article($row);
        $results[] = [
            'lang' => $row['lang'], 'remoteId' => $row['externalId'] . ':' . $row['lang'],
            // The site's base URL FOR THAT LANGUAGE, not just the first configured origin —
            // doitrous_seo_absolute_url already carries that fallback chain (resolve.php).
            'remoteUrl' => doitrous_seo_absolute_url($settings, $row['lang'], doitrous_seo_article_path($row['lang'], $row['slug'])),
        ];
    }
    doitrous_seo_json(['results' => $results, 'skipped' => $skipped]);
}
