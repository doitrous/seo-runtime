<?php

if (!defined('ABSPATH')) exit;

/**
 * Yoast and Rank Math both print a title, a description, canonical, OG and Twitter tags on
 * wp_head. On a page the hub owns, theirs would duplicate ours — so their output is switched off
 * for that request only, by name and priority, leaving their behaviour untouched everywhere else.
 * So is core's own <title> (a theme with title-tag support prints one through
 * _wp_render_title_tag), core's rel_canonical and, where we print alternates, Polylang's hreflang links.
 */
function doitrous_seo_silence_other_seo_plugins(array $seo): void {
    // Yoast: the whole frontend head is one class, removed in one line.
    if (class_exists('WPSEO_Frontend')) {
        remove_action('wp_head', [WPSEO_Frontend::get_instance(), 'head'], 1);
    }
    remove_all_actions('wpseo_head');
    // Rank Math prints through its own head action at priority 1.
    remove_all_actions('rank_math/head');
    // Both filter the document title; ours is printed directly.
    add_filter('pre_get_document_title', fn () => '', 99);
    // An empty pre_get_document_title is "not short-circuited", so core still prints its title.
    remove_action('wp_head', '_wp_render_title_tag', 1);
    // Core's own canonical on singular pages (wp_head 10); ours is always printed.
    remove_action('wp_head', 'rel_canonical');
    if ($seo['alternates']) add_filter('pll_rel_hreflang_attributes', '__return_empty_array');
}

/** The resolved SEO of this request's path when the hub owns it, else null. */
function doitrous_seo_hub_seo(): ?array {
    if (is_admin()) return null;
    $path = doitrous_seo_normalize_path(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $lang = doitrous_seo_site_lang();
    if (!doitrous_seo_get_page($path, $lang)) return null;   // not a hub page: leave the site alone

    return doitrous_seo_resolve($path, $lang);
}

/**
 * Runs on `wp`, before wp_head starts. Core's _wp_render_title_tag (registered first, in
 * default-filters.php) and Polylang's hreflang printer share wp_head priority 1 with
 * doitrous_seo_print_head, and WP_Hook walks a priority's callbacks with a by-value foreach, so
 * removing one from inside that priority does not stop it — it has to go before wp_head fires.
 */
function doitrous_seo_take_over_head(): void {
    $seo = doitrous_seo_hub_seo();
    if ($seo !== null) doitrous_seo_silence_other_seo_plugins($seo);
}

function doitrous_seo_print_head(): void {
    $seo = doitrous_seo_hub_seo();
    if ($seo === null) {
        // Not a hub page: the site keeps its own head, but GA4 still counts the visit.
        if (!is_admin()) echo doitrous_seo_gtag_snippet(doitrous_seo_get_settings()['ga4MeasurementId'] ?? null);
        return;
    }
    doitrous_seo_silence_other_seo_plugins($seo);   // again, for anything hooked after `wp`
    echo doitrous_seo_head_tags($seo);
}

function doitrous_seo_head_tags(array $seo): string {
    $meta = function (string $name, string $content, bool $property = false): string {
        return $content === '' ? '' : sprintf(
            '<meta %s="%s" content="%s">' . "\n",
            $property ? 'property' : 'name', esc_attr($name), esc_attr($content),
        );
    };
    $out = '<title>' . esc_html($seo['title']) . "</title>\n";
    $out .= $meta('description', $seo['description']);
    if ($seo['canonical'] !== '') $out .= '<link rel="canonical" href="' . esc_url($seo['canonical']) . '">' . "\n";
    foreach ($seo['alternates'] as $lang => $href) {
        $out .= '<link rel="alternate" hreflang="' . esc_attr($lang) . '" href="' . esc_url($href) . '">' . "\n";
    }
    $out .= $meta('robots', ($seo['robots']['index'] ? 'index' : 'noindex') . ', ' . ($seo['robots']['follow'] ? 'follow' : 'nofollow'));
    $out .= $meta('og:title', $seo['og']['title'], true) . $meta('og:description', $seo['og']['description'], true);
    $out .= $meta('og:url', $seo['canonical'], true) . $meta('og:image', $seo['og']['image'], true);
    $out .= $meta('twitter:card', $seo['twitter']['image'] !== '' ? 'summary_large_image' : 'summary');
    $out .= $meta('twitter:title', $seo['twitter']['title']) . $meta('twitter:description', $seo['twitter']['description']);
    $out .= $meta('twitter:image', $seo['twitter']['image']);
    $out .= doitrous_seo_verification_meta_tags($seo['verification'] ?? null);
    foreach ($seo['jsonld'] as $entry) {
        // '<' -> the six-character escape, so a literal "</script>" inside a value cannot close
        // the tag. Replacing '<' with a plain '<' (what a collapsed escape looks like) is a no-op.
        $json = str_replace('<', '\u003c', wp_json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $out .= '<script type="application/ld+json">' . $json . "</script>\n";
    }
    $out .= doitrous_seo_gtag_snippet($seo['ga4MeasurementId'] ?? null);

    return $out;
}
