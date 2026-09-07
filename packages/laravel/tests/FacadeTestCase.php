<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Seo;
use Doitrous\SeoRuntime\SeoRuntimeServiceProvider;

/**
 * The B11b variant of TestCase: boots the real service provider so the facade, routes,
 * middleware and Blade directive are wired exactly as a host app would get them. B11's plain
 * TestCase is left untouched — its tests exercise Support/EloquentStore directly, on purpose.
 */
abstract class FacadeTestCase extends TestCase
{
    protected function getPackageProviders($app): array
    {
        return [SeoRuntimeServiceProvider::class];
    }

    protected function getPackageAliases($app): array
    {
        return ['Seo' => Seo::class];
    }

    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);
        $app['config']->set('seo-runtime.secret', 'test-secret');
        $app['config']->set('seo-runtime.slug', 'demo');
    }
}
