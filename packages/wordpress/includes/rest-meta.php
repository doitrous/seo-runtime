<?php

if (!defined('ABSPATH')) exit;

/**
 * Post meta the hub's WordPress adapter (seohub lib/adapters/wordpress.ts) writes over
 * /wp-json/wp/v2/posts. WordPress drops any meta key in a REST request that is not registered
 * with show_in_rest, so each one the adapter sends is registered here.
 *
 *   seo_hub_lang          the article's language ("ar", "en"), sent on every create/update
 *   seo_hub_translations  JSON {lang: post id} of every language of the article, sent with
 *                         seo_hub_hreflang once all its posts exist
 */
function doitrous_seo_register_rest_meta(): void {
    $keys = [
        '_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_opengraph_title', '_yoast_wpseo_opengraph_description',
        'rank_math_title', 'rank_math_description', 'rank_math_facebook_title', 'rank_math_facebook_description',
        'seo_hub_hreflang', 'seo_hub_lang', 'seo_hub_translations',
    ];
    foreach ($keys as $key) {
        register_post_meta('post', $key, [
            'show_in_rest' => true, 'single' => true, 'type' => 'string',
            'auth_callback' => fn ($allowed, $metaKey, $postId) => current_user_can('edit_post', $postId),
        ]);
    }
}

/**
 * Polylang (free) takes no language over the REST API, so a hub post would land in the default
 * language, unpaired. On `rest_after_insert_post` the request's meta is already saved (the posts
 * controller runs meta->update_value() before this action) and the response — whose `link` the hub
 * stores as the post URL — is not built yet, so setting the language here makes that link the
 * language's own (/en/...). A no-op without Polylang, or for a language Polylang does not have.
 */
function doitrous_seo_apply_polylang($post): void {
    if (!function_exists('pll_set_post_language') || !function_exists('pll_languages_list')) return;
    $known = pll_languages_list(['fields' => 'slug']);

    $lang = (string) get_post_meta($post->ID, 'seo_hub_lang', true);
    if (in_array($lang, $known, true)) pll_set_post_language($post->ID, $lang);

    $map = json_decode((string) get_post_meta($post->ID, 'seo_hub_translations', true), true);
    if (!is_array($map) || !function_exists('pll_save_post_translations')) return;
    $map = array_filter(array_map('intval', array_intersect_key($map, array_flip($known))));
    if (count($map) > 1) pll_save_post_translations($map);
}
