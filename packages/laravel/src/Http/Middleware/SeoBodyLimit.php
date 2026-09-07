<?php

namespace Doitrous\SeoRuntime\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SeoBodyLimit
{
    public const MAX_BYTES = 2 * 1024 * 1024;

    /**
     * `Content-Length` alone is not enough — a chunked request carries none — so the actual
     * body length is measured too. PHP has already buffered the request body (chunked or not)
     * into `php://input` by the time middleware runs, so this is a length check on the fully
     * read body rather than a streaming one; `post_max_size` is the outer guard and the
     * demo/site docs set it well above 2M so it never fires first and masks this 413 with a
     * generic PHP-level rejection.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $declared = (int) $request->header('Content-Length', 0);
        if ($declared > self::MAX_BYTES || strlen($request->getContent()) > self::MAX_BYTES) {
            return response()->json(['error' => 'too large'], 413);
        }

        return $next($request);
    }
}
