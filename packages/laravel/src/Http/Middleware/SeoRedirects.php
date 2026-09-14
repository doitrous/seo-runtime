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
        // v2: /{key}.txt for IndexNow key verification. Checked here rather than as a router
        // route — a route pattern broad enough to catch any key would also shadow the host app's
        // own top-level *.txt routes even when no key is configured; this checks the ONE exact
        // expected path and falls through to $next for everything else, same as a redirect miss.
        $key = Seo::indexNowKeyFile($request->getPathInfo());
        if ($key !== null) return response($key, 200, ['Content-Type' => 'text/plain; charset=UTF-8']);

        $hit = Seo::redirect($request->getPathInfo());
        if ($hit) return redirect($hit['destination'], $hit['status']);

        return $next($request);
    }
}
