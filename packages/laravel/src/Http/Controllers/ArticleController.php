<?php

namespace Doitrous\SeoRuntime\Http\Controllers;

use Doitrous\SeoRuntime\Seo;
use Illuminate\Http\Request;

class ArticleController
{
    public function upsert(Request $request)
    {
        // Seo::ingest reads config('seo-runtime.on_article') itself, so a site that keeps its own
        // storage (TourMedX) only sets that config value — there is no second code path here.
        $out = Seo::ingest($request->json()->all());

        return response()->json($out['body'], $out['status']);
    }
}
