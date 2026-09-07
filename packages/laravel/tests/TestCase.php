<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Store\EloquentStore;
use Orchestra\Testbench\TestCase as Orchestra;

/**
 * The base every test extends. B11 ships no service provider (that is B11b), so this boots plain
 * Testbench — an in-memory sqlite connection and the package migration — and owns the two
 * snapshot fixtures the other test files use. Every test in this suite exercises
 * `Doitrous\SeoRuntime\Store\EloquentStore` and the `Support` classes directly, never a facade.
 */
abstract class TestCase extends Orchestra
{
    /** In-memory sqlite, so the suite needs no database service and leaves nothing behind. */
    protected function defineEnvironment($app): void
    {
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', [
            'driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '',
        ]);
        $app['config']->set('seo-runtime.supported', ['en', 'ar']);
    }

    protected function defineDatabaseMigrations(): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
    }

    protected function store(): EloquentStore
    {
        return new EloquentStore();
    }

    /** The single-language fixture. Identical field for field to the JS test fixtures. */
    protected function snapshot(array $over = []): array
    {
        return array_merge([
            'version' => 2,
            'siteSlug' => 'demo',
            'settings' => [
                'baseUrls' => ['en' => 'https://x.com', 'ar' => 'https://x.com'],
                'indexingEnabled' => true,
                'brandSuffix' => ' | X',
                'defaultOgImage' => 'https://x.com/og.png',
                'organization' => ['name' => 'X Co', 'logo' => '', 'sameAs' => [], 'phone' => '', 'email' => '', 'address' => '', 'hours' => '', 'type' => 'Organization'],
                'robotsExtra' => ['Disallow: /tmp'],
                'pageDefaults' => ['page' => ['titleTemplate' => '%s', 'schemaType' => 'WebPage', 'changefreq' => 'weekly', 'priority' => 0.7]],
                'reservedPrefixes' => ['/api', '/admin'],
                'twitterHandle' => '@x',
            ],
            'pages' => [$this->page('en', '/en/a')],
            'redirects' => [
                ['source' => '/old', 'destination' => '/en/a', 'type' => 301, 'active' => true],
                ['source' => '/bad', 'destination' => 'http://evil.example', 'type' => 301, 'active' => true],
            ],
        ], $over);
    }

    /** The same fixture plus the Arabic translation, in the same hreflang group. */
    protected function twoLanguageSnapshot(array $over = []): array
    {
        $s = $this->snapshot($over);
        $s['pages'][] = $this->page('ar', '/ar/a');

        return $s;
    }

    protected function page(string $lang, string $path): array
    {
        return [
            'key' => 'p:1', 'type' => 'page', 'lang' => $lang, 'path' => $path, 'group' => 'p:1',
            'title' => 'A', 'updatedAt' => '2026-09-01T00:00:00.000Z',
            'seo' => [
                'seoTitle' => 'A page', 'metaDescription' => 'About A.', 'canonical' => '',
                'index' => true, 'follow' => true, 'includeInSitemap' => true, 'priority' => 0.8,
                'og' => ['title' => '', 'description' => '', 'image' => ''],
                'twitter' => ['title' => '', 'description' => '', 'image' => ''],
                'schemaType' => '', 'structuredData' => [], 'faq' => [],
            ],
        ];
    }
}
