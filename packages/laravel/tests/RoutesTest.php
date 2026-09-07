<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Http\Middleware\SeoBodyLimit;

/**
 * HTTP-level coverage for the routes/middleware/controllers this task adds: auth, the body
 * limit, the unknown-route 404, and the two anonymous routes' content types. The conformance
 * suite covers the same contract against a real demo app; this is the fast, in-process version
 * that runs under `phpunit` with no server to boot.
 */
class RoutesTest extends FacadeTestCase
{
    public function test_health_requires_the_bearer_secret(): void
    {
        $this->getJson('/api/seo/health')->assertStatus(401)->assertExactJson(['error' => 'unauthorized']);
        $this->withHeader('Authorization', 'Bearer test-secret')
            ->getJson('/api/seo/health')->assertStatus(200);
    }

    public function test_an_unknown_seo_route_is_401_then_404(): void
    {
        $this->getJson('/api/seo/nope')->assertStatus(401);
        $this->withHeader('Authorization', 'Bearer test-secret')
            ->getJson('/api/seo/nope')->assertStatus(404)->assertExactJson(['error' => 'not found']);
    }

    public function test_sync_applies_a_snapshot_and_echoes_the_version(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer test-secret')
            ->postJson('/api/seo/sync', $this->snapshot());
        $res->assertStatus(200)->assertJson(['status' => 'applied', 'version' => 2]);
    }

    public function test_an_invalid_sync_body_is_400_never_500(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer test-secret')
            ->postJson('/api/seo/sync', ['not' => 'a snapshot']);
        $res->assertStatus(400)->assertJson(['status' => 'invalid', 'version' => 0]);
    }

    public function test_a_body_over_the_limit_is_413(): void
    {
        $huge = str_repeat('x', SeoBodyLimit::MAX_BYTES + 1);
        $res = $this->call('POST', '/api/articles', [], [], [], [
            'HTTP_Authorization' => 'Bearer test-secret',
            'CONTENT_TYPE' => 'application/json',
        ], $huge);
        $res->assertStatus(413);
        $this->assertSame(['error' => 'too large'], json_decode($res->getContent(), true));
    }

    public function test_a_body_at_the_limit_is_not_413(): void
    {
        $atLimit = str_repeat('x', SeoBodyLimit::MAX_BYTES);
        $res = $this->call('POST', '/api/articles', [], [], [], [
            'HTTP_Authorization' => 'Bearer test-secret',
            'CONTENT_TYPE' => 'application/json',
        ], $atLimit);
        $this->assertNotSame(413, $res->getStatusCode());
    }

    public function test_sitemap_and_robots_are_anonymous_with_the_contract_content_types(): void
    {
        $this->store()->putSnapshot($this->snapshot());
        $this->get('/sitemap.xml')->assertStatus(200)->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
        $this->get('/robots.txt')->assertStatus(200)->assertHeader('Content-Type', 'text/plain; charset=UTF-8');
    }

    public function test_articles_are_ingested_over_http(): void
    {
        $this->store()->putSnapshot($this->snapshot());
        $res = $this->withHeader('Authorization', 'Bearer test-secret')->postJson('/api/articles', [
            'externalId' => 1,
            'articles' => [['lang' => 'en', 'title' => 'A', 'slug' => 'a-post', 'bodyMd' => "# A\n\nBody."]],
        ]);
        $res->assertStatus(200);
        $this->assertSame('en', $res->json('results.0.lang'));
    }
}
