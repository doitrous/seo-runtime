<?php

namespace Doitrous\SeoRuntime\Tests;

/**
 * V2-PHASE-8 / packages/CONTRACT.md: `seo-runtime.routes.help` and `.editorial_guidelines` skip
 * registering the two routes this ticket added, for a host app that already has its own route at
 * that path. Routes are registered once at boot (routes/seo.php), so the flag has to be false
 * before the app boots — hence a dedicated class overriding defineEnvironment rather than calling
 * config() from inside a test body (RoutesTest/V2Test share one booted app per default config).
 */
class RouteFlagsTest extends FacadeTestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);
        $app['config']->set('seo-runtime.routes.help', false);
        $app['config']->set('seo-runtime.routes.editorial_guidelines', false);
    }

    public function test_the_flags_skip_registering_help_index_and_editorial_guidelines_but_leave_help_slug_unconditional(): void
    {
        $this->get('/help')->assertStatus(404);
        $this->get('/editorial-guidelines')->assertStatus(404);

        $this->store()->putSnapshot($this->snapshot(['settings' => array_merge($this->snapshot()['settings'], [
            'helpEntries' => [['slug' => 'refund', 'lang' => 'en', 'question' => 'Q?', 'answerHtml' => '<p>A.</p>', 'moneyPageUrl' => '', 'updatedAt' => '2026-09-01T00:00:00.000Z']],
        ])]));
        $this->get('/help/refund')->assertStatus(200);
    }
}
