<?php

if (!defined('ABSPATH')) exit;

/**
 * Yoast and Rank Math both print a title, a description, canonical, OG and Twitter tags on
 * wp_head. On a page the hub owns, theirs would duplicate ours — so their output is switched off
 * for that request only, by name and priority, leaving their behaviour untouched everywhere else.
 */
function doitrous_seo_silence_other_seo_plugins(): void {
    // Yoast: the whole frontend head is one class, removed in one line.
    if (class_exists('WPSEO_Frontend')) {
        remove_action('wp_head', [WPSEO_Frontend::get_instance(), 'head'], 1);
    }
    remove_all_actions('wpseo_head');
    // Rank Math prints through its own head action at priority 1.
    remove_all_actions('rank_math/head');
    // Both filter the document title; ours is printed directly.
    add_filter('pre_get_document_title', fn () => '', 99);
}

function doitrous_seo_print_head(): void {
    if (is_admin()) return;
    $path = doitrous_seo_normalize_path(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $lang = doitrous_seo_site_lang();
    if (!doitrous_seo_get_page($path, $lang)) return;   // not a hub page: leave the site alone
    doitrous_seo_silence_other_seo_plugins();
    echo doitrous_seo_head_tags(doitrous_seo_resolve($path, $lang));
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
    foreach ($seo['jsonld'] as $entry) {
        // '<' -> the six-character escape, so a literal "</script>" inside a value cannot close
        // the tag. Replacing '<' with a plain '<' (what a collapsed escape looks like) is a no-op.
        $json = str_replace('<', '\u003c', wp_json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $out .= '<script type="application/ld+json">' . $json . "</script>\n";
    }

    return $out;
}
