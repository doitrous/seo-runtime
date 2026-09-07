<?php

namespace Doitrous\SeoRuntime\Http\Controllers;

use Doitrous\SeoRuntime\Seo;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class SeoController
{
    public function sync(Request $request)
    {
        $out = Seo::apply($request->json()->all());

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
}
