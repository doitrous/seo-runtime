<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\SeoManager;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class BootPullBackoffTest extends FacadeTestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);
        $app['config']->set('seo-runtime.hub_url', 'https://hub.test');
        $app['config']->set('cache.default', 'array');
    }

    public function test_a_failed_boot_pull_is_not_retried_within_five_minutes(): void
    {
        Cache::flush();
        Http::fake(['https://hub.test/*' => Http::response('down', 503)]);
        $m = $this->app->make(SeoManager::class);

        $this->assertSame('failed', $m->pullOnBoot());
        $this->assertNull($m->pullOnBoot());
        $this->assertNull($m->pullOnBoot());
        Http::assertSentCount(1);
    }

    public function test_the_backoff_expires_and_a_success_stops_further_pulls(): void
    {
        Cache::flush();
        Http::fake(['https://hub.test/*' => Http::sequence()->push('down', 503)->push($this->snapshot(), 200)]);
        $m = $this->app->make(SeoManager::class);
        $m->pullOnBoot();

        $this->travel(301)->seconds();
        $this->assertSame('applied', $m->pullOnBoot());
        // A snapshot now exists: no further hub calls at all.
        $this->assertNull($m->pullOnBoot());
    }

    public function test_hub_calls_have_a_short_timeout(): void
    {
        $this->assertSame(5, SeoManager::HUB_CONNECT_TIMEOUT);
        $this->assertSame(10, SeoManager::HUB_TIMEOUT);
    }
}
