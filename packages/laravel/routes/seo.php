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
    // v2: pending/approve proxy — this site's secret in (the group's own middleware), the hub's
    // runtime secret out.
    Route::get('/api/seo/pending', [SeoController::class, 'pending']);
    Route::post('/api/seo/approve', [SeoController::class, 'approve']);
    Route::post('/api/seo/reject', [SeoController::class, 'reject']);
    Route::post('/api/seo/publish-now', [SeoController::class, 'publishNow']);
    // v2: IndexNow — this site's own secret in (the group's own middleware), forwards
    // {urlList} to api.indexnow.org with the site's own key.
    Route::post('/api/seo/indexnow', [SeoController::class, 'indexNow']);
});

// v2: the opt-in web-vitals beacon — deliberately OUTSIDE the seo.secret group above: it is
// posted to by a real visitor's browser, which is not a place to keep this site's secret. Still
// behind the same body-size limit as every other POST route, and registered ahead of the
// catch-all below so it is never shadowed by the generic "not found" answer.
Route::post('/api/seo/vitals', [SeoController::class, 'vitals'])->middleware('seo.body');

// Anything else under /api/seo is authenticated before it is a 404 (matches the Express and Next
// packages): the prefix never confirms which routes exist to an anonymous caller.
Route::middleware('seo.secret')->any('/api/seo/{any}', fn () => response()->json(['error' => 'not found'], 404))
    ->where('any', '.*');

// The only anonymous routes. Phase 1 ships a single /sitemap.xml — no sitemap index — so no page
// argument and no /sitemap-{page}.xml route (packages/CONTRACT.md, deferred to phase 2). A host
// app that already defines /sitemap.xml or /robots.txt of its own must remove them.
Route::get('/sitemap.xml', [SeoController::class, 'sitemap']);
Route::get('/robots.txt', [SeoController::class, 'robots']);

// v2: the minimal admin panel — its own auth (query string OR header), not the seo.secret
// middleware, which only ever reads the Bearer header. See SeoController::admin's own docblock.
Route::get('/seo-admin', [SeoController::class, 'admin']);

// v2 content pages, rendered by the package itself (unlike an article: these are new page types
// the ticket asks the runtime to render, not just resolve metadata for). Specific literal
// prefixes, same risk profile as /sitemap.xml and /robots.txt above — never a generic catch-all.
Route::get('/authors/{slug}', [SeoController::class, 'author']);
// `seo-runtime.routes.help` / `.editorial_guidelines` (default true): a host app with its own
// /help or /editorial-guidelines route sets the flag to false, or removes its own route — the
// same either/or as a host app that already defines /sitemap.xml or /robots.txt above. Gates
// only the two routes this ticket added; /help/{slug} (v2, phase 5) is unconditional.
if (config('seo-runtime.routes.help', true)) {
    // The literal /help index is registered ahead of /help/{slug}: Laravel matches literal
    // segments before a parameterized one at the same depth regardless of order, but ahead reads
    // clearest.
    Route::get('/help', [SeoController::class, 'helpIndex']);
}
Route::get('/help/{slug}', [SeoController::class, 'help']);
if (config('seo-runtime.routes.editorial_guidelines', true)) {
    Route::get('/editorial-guidelines', [SeoController::class, 'editorialGuidelines']);
}
Route::get('/tools/{slug}', [SeoController::class, 'tool']);
Route::get('/tools/{slug}/embed', [SeoController::class, 'toolEmbed']);
