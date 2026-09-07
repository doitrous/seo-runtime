<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // A hub redirect must answer before any session/auth middleware runs (packages/CONTRACT.md's
        // Redirects section) — prepend puts it ahead of everything the `web` group would otherwise
        // run first. See Doitrous\SeoRuntime\Http\Middleware\SeoRedirects's own docblock.
        $middleware->prepend(\Doitrous\SeoRuntime\Http\Middleware\SeoRedirects::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
