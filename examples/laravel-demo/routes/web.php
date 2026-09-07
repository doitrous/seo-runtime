<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return 'seo-runtime Laravel demo — see /en, /sitemap.xml, /robots.txt and the /api/seo/* routes.';
});

// A real rendered page for the conformance suite's JSON-LD escape test (resolve.test.mjs), which
// syncs a page at exactly this path/lang and asserts the JSON-LD in the raw response HTML is
// escaped by Snapshot::jsonLdScript, rather than proving it only through the /api/seo/probe API.
Route::get('/{lang}', function (string $lang) {
    return view('demo', ['lang' => $lang]);
})->where('lang', 'en|ar');
