<?php

namespace Doitrous\SeoRuntime\Http\Controllers;

use Doitrous\SeoRuntime\Seo;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class SeoController
{
    public function sync(Request $request)
    {
        // Decode the raw body directly rather than $request->json()->all(): a host app's global
        // TrimStrings middleware (on by default in the Laravel skeleton) mutates that same bag,
        // silently stripping leading/trailing whitespace from every string value it contains —
        // corrupting a legitimate value like a brandSuffix of " | Demo" into "| Demo" before this
        // controller ever sees it. getContent() returns the untouched raw body.
        $out = Seo::apply(json_decode($request->getContent(), true));

        return response()->json($out, $out['status'] === 'invalid' ? 400 : 200);
    }

    public function pages() { return response()->json(['pages' => Seo::pages()]); }

    public function probe(Request $request)
    {
        return response()->json(Seo::resolve((string) $request->query('path', '/'), (string) $request->query('lang', 'en')));
    }

    public function health() { return response()->json(Seo::health()); }

    public function sitemap(): Response
    {
        // The charset is part of the contract: the conformance suite and TourMedX's own feature
        // test both assert `application/xml; charset=UTF-8`. Sitemap::xml throws rather than
        // truncating a sitemap over the 5,000-URL page-size limit (packages/CONTRACT.md) — that
        // is answered 500 with a clear message, matching the Express package, never a silent 200.
        try {
            return response(Seo::sitemapXml(), 200, ['Content-Type' => 'application/xml; charset=UTF-8']);
        } catch (\Throwable $e) {
            return response('sitemap error: ' . $e->getMessage(), 500, ['Content-Type' => 'text/plain; charset=UTF-8']);
        }
    }

    public function robots(): Response
    {
        return response(Seo::robotsTxt(), 200, ['Content-Type' => 'text/plain; charset=UTF-8']);
    }

    private function contentPage(?array $loaded, string $bodyHtmlKey = 'bodyHtml')
    {
        if (!$loaded) return response('not found', 404, ['Content-Type' => 'text/plain; charset=UTF-8']);
        $seo = $loaded['seo'];
        $head = view('seo-runtime::head', ['seo' => $seo])->render();

        return response("<html><head>$head</head><body>{$loaded[$bodyHtmlKey]}</body></html>", 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    }

    public function author(string $slug): Response
    {
        return $this->contentPage(Seo::author($slug));
    }

    public function help(Request $request, string $slug): Response
    {
        $lang = (string) $request->query('lang', ((array) config('seo-runtime.supported', ['en']))[0] ?? 'en');

        return $this->contentPage(Seo::helpEntry($slug, $lang));
    }

    public function tool(Request $request, string $slug): Response
    {
        $lang = (string) $request->query('lang', ((array) config('seo-runtime.supported', ['en']))[0] ?? 'en');

        return $this->contentPage(Seo::tool($slug, $lang));
    }

    /**
     * The iframe-able view of a tool: noindex + canonical to /tools/{slug} so the embed never
     * competes with the real page for ranking. No X-Frame-Options / frame-ancestors anywhere in
     * this package, so any origin may frame it (the browser default) — ported from
     * site-template's app/tools/[slug]/embed/page.tsx.
     */
    public function toolEmbed(Request $request, string $slug): Response
    {
        $lang = (string) $request->query('lang', ((array) config('seo-runtime.supported', ['en']))[0] ?? 'en');

        return $this->contentPage(Seo::toolEmbed($slug, $lang));
    }

    /** v2: pending/approve proxy — this site's secret in, the hub's runtime secret out. */
    public function pending()
    {
        $out = Seo::pending();

        return response()->json($out['body'], $out['status']);
    }

    private function approvalAction(Request $request, string $action)
    {
        // Raw body, not $request->json()->all() — see SeoController::sync's own docblock.
        $body = (array) json_decode($request->getContent(), true);
        $out = Seo::approvalAction($action, (string) ($body['jobId'] ?? ''), (string) ($body['approvedBy'] ?? ''), $body['note'] ?? null);

        return response()->json($out['body'], $out['status']);
    }

    public function approve(Request $request)
    {
        return $this->approvalAction($request, 'approve');
    }

    public function reject(Request $request)
    {
        return $this->approvalAction($request, 'reject');
    }

    public function publishNow(Request $request)
    {
        return $this->approvalAction($request, 'publish-now');
    }

    /** v2: IndexNow — this site's own secret in, forwards {urlList} to api.indexnow.org. */
    public function indexNow(Request $request)
    {
        $body = (array) json_decode($request->getContent(), true);
        $out = Seo::indexNow((array) ($body['urlList'] ?? []));

        return response()->json($out['body'], $out['status']);
    }

    /**
     * v2: the opt-in web-vitals beacon — no secret from the browser, only the site's own
     * `Entities::webVitalsSnippet()` posts here. Secret attached on the way out, in
     * SeoManager::vitals.
     */
    public function vitals(Request $request)
    {
        $body = (array) json_decode($request->getContent(), true);
        $out = Seo::vitals([
            'url' => (string) ($body['url'] ?? ''),
            'lcp' => $body['lcp'] ?? null, 'inp' => $body['inp'] ?? null, 'cls' => $body['cls'] ?? null,
        ]);

        return response()->json($out['body'], $out['status']);
    }

    /**
     * v2: the minimal admin panel. Secret-protected via `?secret=` or `Authorization: Bearer` —
     * documented in README.md — since a plain browser visit can't set a custom header. Its own
     * check, not the `seo.secret` middleware (which only ever reads the Bearer header).
     */
    public function admin(Request $request): Response
    {
        $given = (string) $request->query('secret', $request->bearerToken() ?? '');
        $expected = (string) config('seo-runtime.secret', '');
        if ($expected === '' || !hash_equals($expected, $given)) {
            return response('unauthorized', 401, ['Content-Type' => 'text/plain; charset=UTF-8']);
        }

        return response(view('seo-runtime::admin', ['secret' => $given])->render(), 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    }
}
