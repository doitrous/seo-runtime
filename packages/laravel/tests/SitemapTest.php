<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Support\Articles;
use Doitrous\SeoRuntime\Support\Snapshot;
use Doitrous\SeoRuntime\Support\Sitemap;

class SitemapTest extends TestCase
{
    public function test_the_sitemap_lists_indexable_pages_with_reciprocal_alternates(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->twoLanguageSnapshot());
        $xml = Sitemap::xml($store);
        $this->assertStringContainsString('<loc>https://x.com/en/a</loc>', $xml);
        $this->assertStringContainsString('hreflang="ar"', $xml);
        $this->assertStringContainsString('hreflang="x-default"', $xml);
        $this->assertStringContainsString('<changefreq>weekly</changefreq>', $xml);
        $this->assertStringContainsString('<priority>0.8</priority>', $xml);
    }

    public function test_a_noindex_or_excluded_page_is_left_out(): void
    {
        $store = $this->store();
        $s = $this->twoLanguageSnapshot(['version' => 11]);
        $s['pages'][0]['seo']['index'] = false;
        Snapshot::apply($store, $s);
        $this->assertStringNotContainsString('<loc>https://x.com/en/a</loc>', Sitemap::xml($store));
    }

    public function test_ampersands_in_a_path_are_escaped(): void
    {
        $store = $this->store();
        $s = $this->twoLanguageSnapshot(['version' => 12]);
        $s['pages'][0]['path'] = '/en/a&b';
        Snapshot::apply($store, $s);
        $xml = Sitemap::xml($store);
        $this->assertStringContainsString('a&amp;b', $xml);
        $this->assertStringNotContainsString('<loc>https://x.com/en/a&b</loc>', $xml);
    }

    public function test_a_sitemap_over_the_page_size_throws_instead_of_truncating(): void
    {
        $store = $this->store();
        $s = $this->snapshot(['version' => 20]);
        $s['pages'] = [];
        for ($i = 0; $i < Sitemap::PAGE_SIZE + 1; $i++) {
            $s['pages'][] = $this->page('en', "/en/p$i");
            $s['pages'][$i]['key'] = "p:$i";
            $s['pages'][$i]['group'] = '';
        }
        Snapshot::apply($store, $s);
        $this->expectException(\RuntimeException::class);
        Sitemap::xml($store);
    }

    public function test_robots_lists_the_extra_lines_and_the_sitemap(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->twoLanguageSnapshot());
        $txt = Sitemap::robots($store->getSnapshot());
        $this->assertStringContainsString('User-agent: *', $txt);
        $this->assertStringContainsString('Allow: /', $txt);
        $this->assertStringContainsString('Disallow: /tmp', $txt);
        $this->assertStringContainsString('Sitemap: https://x.com/sitemap.xml', $txt);
    }

    public function test_the_kill_switch_empties_the_sitemap_and_disallows_everything(): void
    {
        $store = $this->store();
        $off = $this->twoLanguageSnapshot(['version' => 21]);
        $off['settings']['indexingEnabled'] = false;
        Snapshot::apply($store, $off);
        $this->assertStringNotContainsString('<url>', Sitemap::xml($store));
        $txt = Sitemap::robots($store->getSnapshot());
        $this->assertStringContainsString('Disallow: /', $txt);
        $this->assertStringNotContainsString('Sitemap:', $txt);
    }

    public function test_a_page_with_no_priority_falls_back_to_the_type_default(): void
    {
        $store = $this->store();
        $s = $this->snapshot(['version' => 22]);
        $s['pages'][0]['seo']['priority'] = null;
        Snapshot::apply($store, $s);
        // pageDefaults.page.priority is 0.7 in the fixture (TestCase::snapshot).
        $this->assertStringContainsString('<priority>0.7</priority>', Sitemap::xml($store));
    }

    public function test_an_unparsable_updated_at_omits_lastmod_instead_of_erroring(): void
    {
        $store = $this->store();
        $s = $this->snapshot(['version' => 23]);
        $s['pages'][0]['updatedAt'] = 'bad';
        Snapshot::apply($store, $s);
        $this->assertStringNotContainsString('<lastmod>', Sitemap::xml($store));
    }

    public function test_a_snapshot_page_at_a_stored_version_url_takes_the_article_hreflang_set(): void
    {
        $store = $this->store();
        $s = $this->twoLanguageSnapshot(['version' => 24]);
        $asPage = fn (string $lang, string $path) => ['key' => 'article:9', 'type' => 'article', 'lang' => $lang, 'path' => $path, 'group' => 'article:9'] + $s['pages'][0];
        $s['pages'] = [$asPage('ar', '/ar/blog/x'), $asPage('ar', '/ar-ae/blog/x'), $asPage('en', '/en/blog/x')];
        Snapshot::apply($store, $s);
        $item = fn (string $lang, string $locale) => ['lang' => $lang, 'locale' => $locale, 'title' => $locale, 'slug' => 'x', 'bodyMd' => "# T\n\nBody."];
        Articles::ingest($store, ['externalId' => 9, 'articles' => [$item('ar', 'ar-SA'), $item('ar', 'ar-AE'), $item('en', 'en-US')]], ['en', 'ar']);

        $entries = Sitemap::entries($store->getSnapshot(), $store->listArticles());
        $this->assertSame(['https://x.com/ar/blog/x', 'https://x.com/ar-ae/blog/x', 'https://x.com/en/blog/x'], array_column($entries, 'loc'));
        foreach ($entries as $e) {
            $this->assertEquals([
                'ar-SA' => 'https://x.com/ar/blog/x', 'ar-AE' => 'https://x.com/ar-ae/blog/x', 'en-US' => 'https://x.com/en/blog/x',
                'ar' => 'https://x.com/ar/blog/x', 'en' => 'https://x.com/en/blog/x', 'x-default' => 'https://x.com/ar/blog/x',
            ], $e['alternates']);
        }
    }

    public function test_an_article_is_listed_at_the_configured_article_path(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->twoLanguageSnapshot(['version' => 13]));
        Articles::ingest($store, [
            'externalId' => 9,
            'articles' => [['lang' => 'en', 'title' => 'Hair', 'slug' => 'hair', 'bodyMd' => "# Hair\n\nBody."]],
        ], ['en', 'ar']);
        $this->assertStringContainsString('<loc>https://x.com/en/blog/hair</loc>', Sitemap::xml($store));

        config()->set('seo-runtime.article_path', fn (string $lang, string $slug) => "/$lang/articles/$slug");
        $this->assertStringContainsString('<loc>https://x.com/en/articles/hair</loc>', Sitemap::xml($store));
    }
}
