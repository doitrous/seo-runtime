<?php

use Doitrous\SeoRuntime\Http\Controllers\ArticleController;
use Doitrous\SeoRuntime\Http\Controllers\SeoController;
use Illuminate\Support\Facades\Route;

// Every runtime route is authenticated, health included: it names the site and enumerates every
// redirect source path. The body limit runs first so an oversized upload is refused before the
// framework buffers it.
Route::middleware(['seo.secret', 'seo.body'])->group(function () {   // auth first, then size: same order as the Express and Next packages
    Route::post('/api/seo/sync', [SeoController::class, 'sync']);
    Route::get('/api/seo/pages', [SeoController::class, 'pages']);
    Route::get('/api/seo/probe', [SeoController::class, 'probe']);
    Route::get('/api/seo/health', [SeoController::class, 'health']);
    Route::post('/api/articles', [ArticleController::class, 'upsert']);
});

// Anything else under /api/seo is authenticated before it is a 404 (matches the Express and Next
// packages): the prefix never confirms which routes exist to an anonymous caller.
Route::middleware('seo.secret')->any('/api/seo/{any}', fn () => response()->json(['error' => 'not found'], 404))
    ->where('any', '.*');

// The only anonymous routes. Phase 1 ships a single /sitemap.xml — no sitemap index — so no page
// argument and no /sitemap-{page}.xml route (packages/CONTRACT.md, deferred to phase 2). A host
// app that already defines /sitemap.xml or /robots.txt of its own must remove them.
Route::get('/sitemap.xml', [SeoController::class, 'sitemap']);
Route::get('/robots.txt', [SeoController::class, 'robots']);
