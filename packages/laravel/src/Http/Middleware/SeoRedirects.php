<?php

namespace Doitrous\SeoRuntime\Http\Middleware;

use Closure;
use Doitrous\SeoRuntime\Seo;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Register this in the GLOBAL middleware stack, before the session and auth groups: a hub
 * redirect must answer before any session is started (packages/CONTRACT.md's Redirects
 * section). On Laravel 11+ that means `bootstrap/app.php`'s `->withMiddleware(fn ($m) =>
 * $m->prepend(\Doitrous\SeoRuntime\Http\Middleware\SeoRedirects::class))` — inside the `web`
 * group it would run after session/auth start, which is too late. See
 * examples/laravel-demo/bootstrap/app.php.
 */
class SeoRedirects
{
    public function handle(Request $request, Closure $next): Response
    {
        $hit = Seo::redirect($request->getPathInfo());
        if ($hit) return redirect($hit['destination'], $hit['status']);

        return $next($request);
    }
}
