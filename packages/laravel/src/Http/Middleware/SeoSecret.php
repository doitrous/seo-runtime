<?php

namespace Doitrous\SeoRuntime\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SeoSecret
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('seo-runtime.secret', '');
        $given = (string) $request->bearerToken();
        if ($expected === '' || !hash_equals($expected, $given)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }

        return $next($request);
    }
}
