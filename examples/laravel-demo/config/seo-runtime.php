<?php

return [
    'hub_url' => env('SEO_HUB_URL', ''),
    'secret' => env('SEO_HUB_SECRET', ''),
    'slug' => env('SEO_SITE_SLUG', ''),

    // The site's page provider: a callable returning
    // [['key','type','lang','path','title','updatedAt'], ...].
    'pages' => null,

    // The demo's fixture pages and articles are bilingual (en/ar) — see the conformance suite's
    // fixture.mjs and health.test.mjs's article-listing test.
    'supported' => ['en', 'ar'],

    // Where this site serves an article: fn (string $lang, string $slug): string.
    // Null means /{lang}/blog/{slug}.
    'article_path' => null,

    // Optional: a callable that takes over article storage entirely. It receives the validated
    // hub payload and returns ['results' => [...], 'skipped' => [...]] plus, optionally, a
    // 'status' the route answers with — that is how a site keeps its own 409 or 422.
    'on_article' => null,
];
