<?php

if (!defined('ABSPATH')) exit;

/**
 * The PHP port of core-js's entities.ts. Every function here has a named counterpart in the JS;
 * when the two disagree, the conformance suite (packages/CONTRACT.md) is the arbiter.
 * v2 fields (authors, helpEntries, tools, verification, indexNowKey, ga4MeasurementId,
 * crawlerPolicy, entity) all live inside `settings`, the same single option every render already
 * reads through doitrous_seo_get_settings() — no new option, no new table.
 */
function doitrous_seo_find_author(array $settings, string $slug): ?array {
    foreach ($settings['authors'] ?? [] as $a) if (($a['slug'] ?? null) === $slug) return $a;

    return null;
}

function doitrous_seo_find_help_entry(array $settings, string $slug, string $lang): ?array {
    foreach ($settings['helpEntries'] ?? [] as $h) if (($h['slug'] ?? null) === $slug && ($h['lang'] ?? null) === $lang) return $h;

    return null;
}

function doitrous_seo_find_tool(array $settings, string $slug, string $lang): ?array {
    foreach ($settings['tools'] ?? [] as $t) if (($t['slug'] ?? null) === $slug && ($t['lang'] ?? null) === $lang) return $t;

    return null;
}

function doitrous_seo_person_jsonld(array $author, string $canonical): array {
    $out = ['@context' => 'https://schema.org', '@type' => 'Person', '@id' => "$canonical#person", 'name' => $author['name'], 'url' => $canonical];
    if (!empty($author['title'])) $out['jobTitle'] = $author['title'];
    if (!empty($author['credentials'])) $out['honorificSuffix'] = $author['credentials'];
    if (!empty($author['bio'])) $out['description'] = $author['bio'];
    if (!empty($author['sameAs'])) $out['sameAs'] = $author['sameAs'];

    return $out;
}

function doitrous_seo_help_article_jsonld(array $entry, string $canonical): array {
    $out = [
        '@context' => 'https://schema.org', '@type' => 'Article', '@id' => "$canonical#article",
        'headline' => $entry['question'], 'url' => $canonical, 'mainEntityOfPage' => $canonical,
        'inLanguage' => $entry['lang'], 'dateModified' => $entry['updatedAt'],
    ];
    if (!empty($entry['moneyPageUrl'])) $out['about'] = $entry['moneyPageUrl'];

    return $out;
}

function doitrous_seo_tool_jsonld(array $tool, string $canonical): array {
    $out = [
        '@context' => 'https://schema.org', '@type' => 'WebApplication', '@id' => "$canonical#tool",
        'name' => $tool['kind'], 'url' => $canonical, 'applicationCategory' => $tool['kind'], 'inLanguage' => $tool['lang'],
    ];
    if (!empty($tool['dataSource'])) $out['creator'] = ['@type' => 'Organization', 'name' => $tool['dataSource']];
    if (!empty($tool['asOf'])) $out['dateModified'] = $tool['asOf'];

    return $out;
}

function doitrous_seo_author_body_html(array $author): string {
    $html = '<h1>' . esc_html($author['name']) . '</h1>';
    if (!empty($author['title'])) $html .= '<p class="seo-author-title">' . esc_html($author['title']) . '</p>';
    if (!empty($author['credentials'])) $html .= '<p class="seo-author-credentials">' . esc_html($author['credentials']) . '</p>';
    if (!empty($author['bio'])) $html .= '<p class="seo-author-bio">' . esc_html($author['bio']) . '</p>';
    if (!empty($author['sameAs'])) {
        $html .= '<ul class="seo-author-same-as">';
        foreach ($author['sameAs'] as $u) $html .= '<li><a href="' . esc_url($u) . '" rel="me">' . esc_html($u) . '</a></li>';
        $html .= '</ul>';
    }

    return $html;
}

/** Question as `<h1>`, answer first — `answerHtml` is pre-rendered, trusted HTML from the hub. */
function doitrous_seo_help_body_html(array $entry): string {
    $html = '<h1>' . esc_html($entry['question']) . '</h1><div class="seo-help-answer">' . $entry['answerHtml'] . '</div>';
    if (!empty($entry['moneyPageUrl'])) $html .= '<p class="seo-help-cta"><a href="' . esc_url($entry['moneyPageUrl']) . '">Learn more</a></p>';

    return $html;
}

function doitrous_seo_tool_body_html(array $tool): string {
    $config = wp_json_encode($tool['config'] ?? [], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $html = '<h1>' . esc_html($tool['kind']) . '</h1>'
        . '<div id="seo-tool-' . esc_attr($tool['slug']) . '" class="seo-tool-placeholder" data-kind="' . esc_attr($tool['kind']) . '" data-config="' . esc_attr($config) . '"></div>';
    if (!empty($tool['methodologyHtml'])) $html .= '<div class="seo-tool-methodology">' . $tool['methodologyHtml'] . '</div>';
    if (!empty($tool['dataSource'])) {
        $html .= '<p class="seo-tool-data-source">Data source: ' . esc_html($tool['dataSource']) . (!empty($tool['asOf']) ? ' (as of ' . esc_html($tool['asOf']) . ')' : '') . '</p>';
    }

    return $html;
}

function doitrous_seo_verification_meta_tags(?array $v): string {
    if (!$v) return '';
    $html = '';
    if (!empty($v['googleMeta'])) $html .= '<meta name="google-site-verification" content="' . esc_attr($v['googleMeta']) . '">' . "\n";
    if (!empty($v['bingMeta'])) $html .= '<meta name="msvalidate.01" content="' . esc_attr($v['bingMeta']) . '">' . "\n";

    return $html;
}

/** Dropped rather than escaped when malformed: the id sits inside a JS string literal, not an attribute. */
function doitrous_seo_gtag_snippet(?string $measurementId): string {
    if (!$measurementId || preg_match('/^[A-Za-z0-9_-]+$/', $measurementId) !== 1) return '';

    return '<script async src="https://www.googletagmanager.com/gtag/js?id=' . $measurementId . '"></script>' . "\n"
        . "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}"
        . "gtag('js',new Date());gtag('config','$measurementId');</script>" . "\n";
}

/** `/{key}.txt` served with the key as the body, or null when `path` doesn't match. */
function doitrous_seo_index_now_key_file(array $settings, string $path): ?string {
    $key = $settings['indexNowKey'] ?? null;
    if (!$key) return null;

    return doitrous_seo_normalize_path($path) === "/$key.txt" ? $key : null;
}

/**
 * The opt-in web-vitals beacon: a site includes this itself (never wired into
 * doitrous_seo_head_tags() the way the gtag snippet is, since not every site wants a beacon on
 * every page) and it never carries this site's own secret — a real visitor's browser is not a
 * place to keep one. It posts LCP/CLS/best-effort INP to this site's own same-origin
 * `POST /api/seo/vitals`, which attaches the secret server-side and relays to the hub
 * (doitrous_seo_vitals(), in approval.php). No `web-vitals` dependency: every metric comes
 * straight off `PerformanceObserver`, which is all that library wraps for these three entry types.
 */
function doitrous_seo_web_vitals_snippet(): string {
    return '<script>(function(){try{'
        . "var m={lcp:0,inp:0,cls:0};"
        . "try{new PerformanceObserver(function(l){var es=l.getEntries();if(es.length)m.lcp=es[es.length-1].startTime;})"
        . ".observe({type:'largest-contentful-paint',buffered:true});}catch(e){}"
        . "try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)m.cls+=e.value;});})"
        . ".observe({type:'layout-shift',buffered:true});}catch(e){}"
        . "try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.duration>m.inp)m.inp=e.duration;});})"
        . ".observe({type:'event',buffered:true,durationThreshold:40});}catch(e){}"
        . "function send(){try{navigator.sendBeacon('/api/seo/vitals',JSON.stringify({url:location.href,lcp:m.lcp,inp:m.inp,cls:m.cls}));}catch(e){}}"
        . "document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')send();});"
        . 'addEventListener("pagehide",send);'
        . '}catch(e){}})();</script>';
}
