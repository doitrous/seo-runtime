<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Support\Articles;
use Doitrous\SeoRuntime\Support\Locale;
use Doitrous\SeoRuntime\Support\Sitemap;
use Doitrous\SeoRuntime\Support\Snapshot;
use Illuminate\Support\Facades\DB;

/** Per-country pages (0.2.0, hub contract 1.20.0) — the port of core-js's locale.test.ts. */
class LocaleTest extends TestCase
{
    private function item(string $lang, ?string $locale, string $slug = 'x', ?string $title = null): array
    {
        return ['lang' => $lang, 'title' => $title ?? 'T ' . ($locale ?? $lang), 'slug' => $slug, 'bodyMd' => "# T\n\nBody."]
            + ($locale !== null ? ['locale' => $locale] : []);
    }

    private function payload(array $items, int $externalId = 9): array
    {
        return ['externalId' => $externalId, 'articles' => $items];
    }

    public function test_the_pure_helpers_match_core_js(): void
    {
        $this->assertSame('ar-AE', Locale::canonical('ar_ae'));
        $this->assertSame('/ar-ae/blog/x', Locale::localizePath('/ar/blog/x', 'ar', 'ar-AE'));
        $this->assertSame('https://x.com/en-us/blog/x', Locale::localizePath('https://x.com/blog/x', 'en', 'en-US'));
        $this->assertSame('/blog/ar-ly/x', Locale::localizePath('/blog/ar/x', 'ar', 'ar-LY'));
        $this->assertSame(['segment' => 'ar-ae', 'lang' => 'ar', 'locale' => 'ar-AE', 'rest' => '/blog/x'], Locale::parsePrefix('/ar-ae/blog/x'));
        $this->assertSame('ar', Locale::parsePrefix('/ar/blog/x')['lang']);
        $this->assertNull(Locale::parsePrefix('/blog/x'));
        $this->assertNull(Locale::parsePrefix('/fr-fr/x', ['en', 'ar']));
    }

    public function test_a_payload_without_locale_answers_exactly_as_0_1_6(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        $out = Articles::ingest($store, $this->payload([$this->item('en', null), $this->item('ar', null)]), ['en', 'ar']);
        $this->assertSame(['status' => 200, 'body' => ['results' => [
            ['lang' => 'en', 'remoteId' => '9:en', 'remoteUrl' => 'https://x.com/en/blog/x'],
            ['lang' => 'ar', 'remoteId' => '9:ar', 'remoteUrl' => 'https://x.com/ar/blog/x'],
        ], 'skipped' => []]], $out);
    }

    public function test_several_locales_of_one_language_get_their_own_urls_and_hreflang(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        $out = Articles::ingest($store, $this->payload([
            $this->item('en', 'en-US'), $this->item('ar', 'ar-SA'), $this->item('ar', 'ar-AE'),
        ]), ['en', 'ar']);
        $this->assertSame(200, $out['status']);
        $this->assertSame([
            ['lang' => 'en', 'locale' => 'en-US', 'remoteId' => '9:en', 'remoteUrl' => 'https://x.com/en/blog/x'],
            ['lang' => 'ar', 'locale' => 'ar-SA', 'remoteId' => '9:ar', 'remoteUrl' => 'https://x.com/ar/blog/x'],
            ['lang' => 'ar', 'locale' => 'ar-AE', 'remoteId' => '9:ar-AE', 'remoteUrl' => 'https://x.com/ar-ae/blog/x'],
        ], $out['body']['results']);
        $rows = $store->listArticles();
        $this->assertCount(3, $rows);
        $expected = [
            'en-US' => 'https://x.com/en/blog/x', 'ar-SA' => 'https://x.com/ar/blog/x', 'ar-AE' => 'https://x.com/ar-ae/blog/x',
            'en' => 'https://x.com/en/blog/x', 'ar' => 'https://x.com/ar/blog/x', 'x-default' => 'https://x.com/en/blog/x',
        ];
        foreach ($rows as $r) $this->assertEquals($expected, $r['hreflang']);

        $this->assertSame('T ar-AE', Articles::find($store, 'ar-ae', 'x')['title']);
        $this->assertSame('T ar-SA', Articles::find($store, 'ar', 'x')['title']);
        $this->assertNull(Articles::find($store, 'ar-sa', 'x'));
        $this->assertSame('/ar-ae/blog/x', Locale::versionPath(Articles::find($store, 'ar-AE', 'x')));

        $xml = Sitemap::xml($store);
        $this->assertStringContainsString('<loc>https://x.com/ar-ae/blog/x</loc>', $xml);
        $this->assertStringContainsString('hreflang="ar-AE" href="https://x.com/ar-ae/blog/x"', $xml);
        $this->assertSame(4, substr_count($xml, '<url>'));   // one page + three versions

        $pages = Snapshot::providerPages($store);
        $this->assertContains(['key' => 'article:9:ar-AE', 'type' => 'article', 'lang' => 'ar', 'path' => '/ar-ae/blog/x', 'title' => 'T ar-AE', 'updatedAt' => $rows[2]['updatedAt'], 'locale' => 'ar-AE'], $pages);
        $this->assertSame(['localeUrls'], Snapshot::health($store, '0.2.0', 'demo')['features']);
    }

    public function test_a_0_1_x_row_is_updated_in_place_when_locale_starts_arriving(): void
    {
        $store = $this->store();
        Articles::ingest($store, $this->payload([$this->item('ar', null, 'x', 'old')]), ['en', 'ar']);
        Articles::ingest($store, $this->payload([$this->item('ar', 'ar-SA', 'x', 'new'), $this->item('ar', 'ar-AE', 'x', 'ae')]), ['en', 'ar']);
        $rows = $store->listArticles();
        $this->assertCount(2, $rows);
        $lead = array_values(array_filter($rows, fn ($r) => $r['lead']))[0];
        $this->assertSame('ar-SA', $lead['locale']);
        $this->assertSame('new', $lead['title']);
    }

    public function test_the_slug_clash_is_checked_per_locale(): void
    {
        $store = $this->store();
        Articles::ingest($store, $this->payload([$this->item('ar', 'ar-SA', 'a'), $this->item('ar', 'ar-AE', 'b')]), ['ar']);
        $this->assertSame(200, Articles::ingest($store, $this->payload([$this->item('ar', 'ar-SA', 'b')], 10), ['ar'])['status']);
        $out = Articles::ingest($store, $this->payload([$this->item('ar', 'ar-SA', 'c'), $this->item('ar', 'ar-AE', 'b')], 11), ['ar']);
        $this->assertSame(409, $out['status']);
        $this->assertSame(['error' => 'slug_taken', 'slug' => 'b', 'lang' => 'ar', 'locale' => 'ar-AE'], $out['body']);
    }

    public function test_a_locale_of_another_language_is_a_400(): void
    {
        $this->assertSame('invalid articles[0].locale', Articles::validate($this->payload([$this->item('ar', 'en-US')]))['error']);
    }

    public function test_the_migration_backfills_locale_from_lang(): void
    {
        $migration = require __DIR__ . '/../database/migrations/2026_10_06_000001_add_locale_to_seo_runtime_articles.php';
        $migration->down();
        DB::table('seo_runtime_articles')->insert([
            'external_id' => 9, 'lang' => 'ar', 'slug' => 'x', 'title' => 'old', 'body_md' => '', 'body_html' => '',
            'faq' => '[]', 'schema_jsonld' => '[]', 'refs' => '[]', 'og' => '{}', 'extra' => '{}',
            'published_at' => '2026-01-01T00:00:00.000Z', 'updated_at' => '2026-01-01T00:00:00.000Z',
        ]);
        $migration->up();
        $row = $this->store()->findArticleBySlug('ar', 'x');
        $this->assertSame('ar', $row['locale']);
        $this->assertTrue($row['lead']);
        $this->assertSame('old', Articles::find($this->store(), 'ar', 'x')['title']);
    }
}
