<?php

namespace Doitrous\SeoRuntime\Tests;

use Illuminate\Support\Facades\Http;

/**
 * Phase 5 v2 fields: all optional, all live inside `settings` (no migration needed), covered
 * here field for field against the same fixture the other Laravel tests use. The conformance
 * suite (packages/conformance) is the arbiter across stacks; this is the fast in-process version.
 */
class V2Test extends FacadeTestCase
{
    private function snapshotWith(array $settingsOver): array
    {
        return $this->snapshot(['settings' => array_merge($this->snapshot()['settings'], $settingsOver)]);
    }

    public function test_robots_renders_a_per_ua_block_for_each_allowed_and_disallowed_crawler(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['crawlerPolicy' => ['allow' => ['ClaudeBot'], 'disallow' => ['GPTBot']]]));
        $txt = $this->get('/robots.txt')->getContent();
        $this->assertMatchesRegularExpression('/User-agent: ClaudeBot\nAllow: \//', $txt);
        $this->assertMatchesRegularExpression('/User-agent: GPTBot\nDisallow: \//', $txt);
    }

    public function test_the_entity_block_is_rendered_when_schema_org_shaped_and_dropped_otherwise(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['entity' => ['@context' => 'https://schema.org', '@type' => 'MedicalOrganization']]));
        $res = $this->withHeader('Authorization', 'Bearer test-secret')->getJson('/api/seo/probe?path=/en/a&lang=en');
        $types = array_column($res->json('jsonld'), '@type');
        $this->assertContains('MedicalOrganization', $types);
    }

    public function test_an_invalid_entity_override_is_dropped_at_sync_time(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer test-secret')
            ->postJson('/api/seo/sync', $this->snapshotWith(['entity' => ['name' => 'no context']]));
        $res->assertStatus(200);
        $this->assertNull($this->store()->getSettings()['entity']);
    }

    public function test_an_author_page_renders_a_person_json_ld_block_and_404s_for_an_unknown_slug(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['authors' => [
            ['slug' => 'jane', 'name' => 'Jane Doe', 'title' => 'Editor', 'credentials' => '', 'sameAs' => [], 'bio' => ''],
        ]]));
        $html = $this->get('/authors/jane')->assertStatus(200)->getContent();
        $this->assertStringContainsString('<h1>Jane Doe</h1>', $html);
        $this->assertStringContainsString('"@type":"Person"', $html);
        $this->get('/authors/nope')->assertStatus(404);
    }

    public function test_a_help_page_puts_the_question_in_an_h1_with_an_article_json_ld_carrying_date_modified(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['helpEntries' => [
            ['slug' => 'refund', 'lang' => 'en', 'question' => 'How do refunds work?', 'answerHtml' => '<p>Answer.</p>', 'moneyPageUrl' => '/pricing', 'updatedAt' => '2026-09-01T00:00:00.000Z'],
        ]]));
        $html = $this->get('/help/refund')->assertStatus(200)->getContent();
        $this->assertStringContainsString('<h1>How do refunds work?</h1>', $html);
        $this->assertStringContainsString('"@type":"Article"', $html);
        $this->assertStringContainsString('"dateModified":"2026-09-01T00:00:00.000Z"', $html);
    }

    public function test_the_help_index_lists_this_languages_entries_and_200s_with_none_and_the_help_tool_author_bodies_carry_a_share_block(): void
    {
        $empty = $this->get('/help');
        $empty->assertStatus(200);
        $this->assertStringContainsString('No help entries yet', $empty->getContent());

        $this->store()->putSnapshot($this->snapshotWith([
            'authors' => [['slug' => 'jane', 'name' => 'Jane Doe', 'title' => 'Editor', 'credentials' => '', 'sameAs' => [], 'bio' => '']],
            'helpEntries' => [['slug' => 'refund', 'lang' => 'en', 'question' => 'How do refunds work?', 'answerHtml' => '<p>Answer.</p>', 'moneyPageUrl' => '/pricing', 'updatedAt' => '2026-09-01T00:00:00.000Z']],
            'tools' => [['slug' => 'calc', 'lang' => 'en', 'kind' => 'Calculator', 'config' => [], 'methodologyHtml' => '<p>Method.</p>', 'dataSource' => 'ONS', 'asOf' => '2026-08-01']],
        ]));
        $index = $this->get('/help')->assertStatus(200)->getContent();
        $this->assertStringContainsString('<a href="/help/refund?lang=en">How do refunds work?</a>', $index);
        $this->assertStringContainsString('seo-share', $index);

        foreach (['/help/refund', '/authors/jane', '/tools/calc'] as $path) {
            $html = $this->get($path)->assertStatus(200)->getContent();
            $this->assertStringContainsString('class="seo-share"', $html);
            $this->assertStringContainsString('navigator.share', $html);
        }
    }

    public function test_editorial_guidelines_renders_the_hub_html_with_a_share_block_and_a_placeholder_when_unset(): void
    {
        $empty = $this->get('/editorial-guidelines')->assertStatus(200)->getContent();
        $this->assertStringContainsString('not published yet', $empty);

        $this->store()->putSnapshot($this->snapshotWith(['editorialGuidelinesHtml' => '<p>How we write.</p>']));
        $html = $this->get('/editorial-guidelines')->assertStatus(200)->getContent();
        $this->assertStringContainsString('<h1>Editorial guidelines</h1><p>How we write.</p>', $html);
        $this->assertStringContainsString('class="seo-share"', $html);
    }

    public function test_share_false_drops_the_health_flag_and_the_share_block_from_the_rendered_pages(): void
    {
        config(['seo-runtime.share' => false]);
        $this->store()->putSnapshot($this->snapshotWith([
            'helpEntries' => [['slug' => 'refund', 'lang' => 'en', 'question' => 'How do refunds work?', 'answerHtml' => '<p>Answer.</p>', 'moneyPageUrl' => '/pricing', 'updatedAt' => '2026-09-01T00:00:00.000Z']],
        ]));
        $health = $this->withHeader('Authorization', 'Bearer test-secret')->getJson('/api/seo/health');
        $this->assertFalse($health->json('share'));
        $html = $this->get('/help/refund')->assertStatus(200)->getContent();
        $this->assertStringNotContainsString('seo-share', $html);
    }

    public function test_a_tool_page_renders_the_placeholder_container_with_a_web_application_json_ld(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['tools' => [
            ['slug' => 'calc', 'lang' => 'en', 'kind' => 'Calculator', 'config' => [], 'methodologyHtml' => '<p>Method.</p>', 'dataSource' => 'ONS', 'asOf' => '2026-08-01'],
        ]]));
        $html = $this->get('/tools/calc')->assertStatus(200)->getContent();
        $this->assertStringContainsString('id="seo-tool-calc"', $html);
        $this->assertStringContainsString('"@type":"WebApplication"', $html);
    }

    public function test_the_tool_page_embeds_a_nofollowed_brand_link_and_an_origin_scoped_resize_listener(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['tools' => [
            ['slug' => 'calc', 'lang' => 'en', 'kind' => 'Calculator', 'config' => [], 'methodologyHtml' => '<p>Method.</p>', 'dataSource' => 'ONS', 'asOf' => '2026-08-01'],
        ]]));
        $html = $this->get('/tools/calc')->assertStatus(200)->getContent();
        // The snippet lives HTML-escaped inside a <textarea readonly>, so its own quotes come back as entities.
        // siteName is settings.organization.name ('X Co' in the shared fixture), not the origin host.
        $this->assertStringContainsString('rel=&quot;nofollow&quot;&gt;X Co&lt;/a&gt;', $html);
        $this->assertStringContainsString('iframe[src^=&quot;https://x.com/&quot;]', $html);
        $this->assertStringContainsString('<script src="/seo-tools.js" defer></script>', $html);
    }

    // V2-PHASE-8: these five routes have no stored page record for resolve() to group alternates
    // from, so SeoManager::alternatesFor supplies them synthetically off config('seo-runtime.supported')
    // (['en', 'ar'] here, per TestCase::defineEnvironment). The embed route is excluded on purpose
    // (packages/CONTRACT.md) and must keep printing none.
    public function test_the_five_locale_free_routes_carry_hreflang_for_every_supported_language_but_the_tool_embed_carries_none(): void
    {
        $this->store()->putSnapshot($this->snapshotWith([
            'authors' => [['slug' => 'jane', 'name' => 'Jane Doe', 'title' => 'Editor', 'credentials' => '', 'sameAs' => [], 'bio' => '']],
            'helpEntries' => [['slug' => 'refund', 'lang' => 'en', 'question' => 'How do refunds work?', 'answerHtml' => '<p>Answer.</p>', 'moneyPageUrl' => '/pricing', 'updatedAt' => '2026-09-01T00:00:00.000Z']],
            'tools' => [['slug' => 'calc', 'lang' => 'en', 'kind' => 'Calculator', 'config' => [], 'methodologyHtml' => '<p>Method.</p>', 'dataSource' => 'ONS', 'asOf' => '2026-08-01']],
        ]));

        foreach (['/help', '/help/refund', '/editorial-guidelines', '/authors/jane', '/tools/calc'] as $path) {
            $html = $this->get($path)->assertStatus(200)->getContent();
            $this->assertStringContainsString("<link rel=\"alternate\" hreflang=\"en\" href=\"$path?lang=en\">", $html);
            $this->assertStringContainsString("<link rel=\"alternate\" hreflang=\"ar\" href=\"$path?lang=ar\">", $html);
            $this->assertStringContainsString("<link rel=\"alternate\" hreflang=\"x-default\" href=\"$path?lang=en\">", $html);
        }

        $embed = $this->get('/tools/calc/embed')->assertStatus(200)->getContent();
        $this->assertStringNotContainsString('hreflang=', $embed);
    }

    // V2-PHASE-8: hub-supplied slug/question, hostile — helpIndexBodyHtml rawurlencode's the href
    // segments before Sitemap::xmlEscape's attribute escaping (belt and braces), mirroring
    // core-js's entities.test.ts XSS case for parity.
    public function test_help_index_body_html_encodes_a_hostile_slug_and_question_so_neither_breaks_out_of_the_href_or_link_text(): void
    {
        $html = \Doitrous\SeoRuntime\Support\Entities::helpIndexBodyHtml([
            'helpEntries' => [[
                'slug' => '"><script>alert(1)</script>', 'lang' => 'en',
                'question' => '</a><script>alert(2)</script>', 'answerHtml' => '', 'moneyPageUrl' => '', 'updatedAt' => '',
            ]],
        ], 'en');
        $this->assertStringNotContainsString('"><script>alert(1)</script>', $html);
        $this->assertStringNotContainsString('</a><script>alert(2)</script>', $html);
        $this->assertStringNotContainsString('<script>alert', $html);
        // rawurlencode (unlike JS's encodeURIComponent) also escapes '(' and ')'.
        $this->assertStringContainsString('href="/help/%22%3E%3Cscript%3Ealert%281%29%3C%2Fscript%3E?lang=en"', $html);
    }

    public function test_embedsnippet_encodes_a_hub_supplied_slug_so_a_quote_in_it_can_never_break_out_of_the_src_href_attribute(): void
    {
        $html = \Doitrous\SeoRuntime\Support\Entities::embedSnippet(
            'https://site.test', 'calc"><script>x</script>', 'en', 'Calculator', 'Site Co'
        );
        $this->assertStringNotContainsString('"><script>x</script>', $html);
        $this->assertStringContainsString('src="https://site.test/tools/calc%22%3E%3Cscript%3Ex%3C%2Fscript%3E/embed', $html);
        $this->assertStringContainsString('<a href="https://site.test/tools/calc%22%3E%3Cscript%3Ex%3C%2Fscript%3E">', $html);
    }

    public function test_the_tool_embed_route_answers_200_with_noindex_follow_and_the_canonical_and_404s_for_an_unknown_slug(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['tools' => [
            ['slug' => 'calc', 'lang' => 'en', 'kind' => 'Calculator', 'config' => [], 'methodologyHtml' => '<p>Method.</p>', 'dataSource' => 'ONS', 'asOf' => '2026-08-01'],
        ]]));
        $html = $this->get('/tools/calc/embed')->assertStatus(200)->getContent();
        $this->assertStringContainsString('<meta name="robots" content="noindex, follow">', $html);
        $this->assertStringContainsString('<link rel="canonical" href="https://x.com/tools/calc">', $html);
        $this->assertStringContainsString('id="seo-tool-calc"', $html);
        $this->assertStringContainsString('target="_top"', $html);
        $this->get('/tools/nope/embed')->assertStatus(404);
    }

    /**
     * `Seo::indexNowKeyFile()` is what `SeoRedirects::handle()` calls (see that middleware's own
     * docblock) — checked directly here, the same way `Snapshot`'s own tests exercise Support
     * classes rather than HTTP: the middleware is only ever wired globally by a host app's own
     * `bootstrap/app.php` (examples/laravel-demo's does; this package's test harness does not),
     * so an HTTP-level assertion here would test nothing this suite actually registers.
     */
    public function test_the_indexnow_key_file_matches_only_the_exact_key_txt_path(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['indexNowKey' => 'abc123def']));
        $this->assertSame('abc123def', \Doitrous\SeoRuntime\Seo::indexNowKeyFile('/abc123def.txt'));
        $this->assertNull(\Doitrous\SeoRuntime\Seo::indexNowKeyFile('/other.txt'));
    }

    public function test_verification_and_ga4_are_rendered_in_the_head(): void
    {
        $this->store()->putSnapshot($this->snapshotWith([
            'verification' => ['googleMeta' => 'g-abc', 'bingMeta' => 'b-xyz'],
            'ga4MeasurementId' => 'G-ABC123',
        ]));
        $html = \Doitrous\SeoRuntime\Seo::head('/en/a', 'en');
        $this->assertStringContainsString('name="google-site-verification" content="g-abc"', $html);
        $this->assertStringContainsString('name="msvalidate.01" content="b-xyz"', $html);
        $this->assertStringContainsString("gtag('config','G-ABC123')", $html);
    }

    // === v2: pending/approve proxy =============================================================

    public function test_pending_proxies_the_hub_with_the_site_secret_and_passes_the_status_body_through(): void
    {
        config(['seo-runtime.hub_url' => 'https://hub.test']);
        Http::fake(['https://hub.test/api/sites/demo/pending' => Http::response(['jobs' => [['id' => 1]]], 200)]);
        $res = $this->withHeader('Authorization', 'Bearer test-secret')->getJson('/api/seo/pending');
        $res->assertStatus(200)->assertJson(['jobs' => [['id' => 1]]]);
        Http::assertSent(fn ($req) => $req->url() === 'https://hub.test/api/sites/demo/pending' && $req->hasHeader('Authorization', 'Bearer test-secret'));
    }

    public function test_approve_posts_approved_by_and_note_to_the_hub_and_relays_a_publish_blocked_error(): void
    {
        config(['seo-runtime.hub_url' => 'https://hub.test']);
        Http::fake(['https://hub.test/api/sites/demo/jobs/9/approve' => Http::response(['error' => 'publish_blocked', 'reason' => 'draft_only'], 409)]);
        $res = $this->withHeader('Authorization', 'Bearer test-secret')
            ->postJson('/api/seo/approve', ['jobId' => '9', 'approvedBy' => 'Jane', 'note' => 'ok']);
        $res->assertStatus(409)->assertJson(['error' => 'publish_blocked', 'reason' => 'draft_only']);
        Http::assertSent(fn ($req) => $req->url() === 'https://hub.test/api/sites/demo/jobs/9/approve' && $req['approvedBy'] === 'Jane' && $req['note'] === 'ok');
    }

    public function test_the_pending_proxy_needs_the_site_secret(): void
    {
        $this->getJson('/api/seo/pending')->assertStatus(401);
    }

    public function test_the_admin_panel_is_secret_protected_via_query_or_header(): void
    {
        $this->get('/seo-admin')->assertStatus(401);
        $this->get('/seo-admin?secret=test-secret')->assertStatus(200);
        $this->withHeader('Authorization', 'Bearer test-secret')->get('/seo-admin')->assertStatus(200);
    }

    // === v2: IndexNow ===========================================================================

    public function test_indexnow_needs_the_site_secret_then_forwards_urllist_to_indexnow_with_the_site_key(): void
    {
        $this->store()->putSnapshot($this->snapshotWith(['indexNowKey' => 'the-key']));
        $this->postJson('/api/seo/indexnow', ['urlList' => ['https://example.com/en/a']])->assertStatus(401);

        Http::fake(['https://api.indexnow.org/indexnow' => Http::response('', 200)]);
        $res = $this->withHeader('Authorization', 'Bearer test-secret')
            ->postJson('/api/seo/indexnow', ['urlList' => ['https://example.com/en/a', 'https://other.example/x']]);
        $res->assertStatus(200);
        Http::assertSent(fn ($req) => $req->url() === 'https://api.indexnow.org/indexnow'
            && $req['host'] === 'example.com' && $req['key'] === 'the-key'
            && $req['keyLocation'] === 'https://example.com/the-key.txt'
            // The other.example URL is dropped: IndexNow requires every URL in one batch to
            // share the batch's host.
            && $req['urlList'] === ['https://example.com/en/a']);
    }

    public function test_indexnow_is_misconfigured_without_an_indexnowkey(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer test-secret')
            ->postJson('/api/seo/indexnow', ['urlList' => ['https://example.com/en/a']]);
        $res->assertStatus(502);
    }

    // === v2: the web-vitals beacon ==============================================================

    public function test_the_vitals_beacon_needs_no_secret_and_relays_the_sample_to_the_hub_with_one(): void
    {
        config(['seo-runtime.hub_url' => 'https://hub.test']);
        Http::fake(['https://hub.test/api/runtime/vitals' => Http::response('', 204)]);
        // No Authorization header at all — a real visitor's browser sends none.
        $res = $this->postJson('/api/seo/vitals', ['url' => 'https://example.com/en/a', 'lcp' => 1200, 'inp' => 50, 'cls' => 0.01]);
        $res->assertStatus(204);
        Http::assertSent(fn ($req) => $req->url() === 'https://hub.test/api/runtime/vitals'
            && $req->hasHeader('Authorization', 'Bearer test-secret')
            && $req['siteSlug'] === 'demo' && $req['url'] === 'https://example.com/en/a'
            && $req['lcp'] === 1200 && $req['source'] === 'rum');
    }

    public function test_the_vitals_beacon_is_400_without_a_url(): void
    {
        config(['seo-runtime.hub_url' => 'https://hub.test']);
        $this->postJson('/api/seo/vitals', [])->assertStatus(400);
    }

    public function test_webvitalssnippet_posts_to_this_sites_own_vitals_route_never_a_hub_url_or_a_secret(): void
    {
        $html = \Doitrous\SeoRuntime\Support\Entities::webVitalsSnippet();
        $this->assertStringContainsString("sendBeacon('/api/seo/vitals'", $html);
        $this->assertStringNotContainsString('http://', $html);
        $this->assertStringNotContainsString('https://', $html);
    }
}
