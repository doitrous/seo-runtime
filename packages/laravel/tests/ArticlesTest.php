<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Support\Articles;
use Doitrous\SeoRuntime\Support\Snapshot;

class ArticlesTest extends TestCase
{
    private function payload(array $over = []): array
    {
        return array_merge([
            'externalId' => 9,
            'author' => ['name' => 'Dr A', 'credentials' => 'MD'],
            'image' => ['url' => 'https://x.com/a.png', 'alt' => 'a clinic room'],
            'reviewer' => ['name' => 'Dr B', 'credentials' => 'MD'],
            'cta' => ['text' => 'Book', 'url' => 'https://x.com/book'],
            'articles' => [[
                'lang' => 'en', 'title' => 'Hair', 'slug' => 'hair',
                'metaTitle' => 'Hair', 'metaDescription' => '', 'bodyMd' => "# Hair\n\nThe body.",
                'faq' => [['q' => 'Q', 'a' => 'A']], 'schemaJsonld' => [],
                'introduction' => 'A lede.', 'references' => [['title' => 'S', 'url' => 'https://pubmed.gov/1']],
                'secondaryKeywords' => ['cost'],
            ]],
        ], $over);
    }

    public function test_validation_names_the_first_bad_field(): void
    {
        $this->assertSame('invalid externalId', Articles::validate(['articles' => []])['error']);
        $this->assertSame('invalid articles', Articles::validate(['externalId' => 9, 'articles' => []])['error']);
        foreach (['a/b', '../etc', 'a?b', 'a b', ''] as $slug) {
            $bad = $this->payload();
            $bad['articles'][0]['slug'] = $slug;
            $this->assertSame('invalid articles[0].slug', Articles::validate($bad)['error'], $slug);
        }
    }

    public function test_a_non_ascii_slug_is_accepted(): void
    {
        $p = $this->payload();
        $p['articles'][0]['lang'] = 'ar';
        $p['articles'][0]['slug'] = 'زراعة-الشعر';
        $this->assertArrayHasKey('payload', Articles::validate($p));
    }

    public function test_markdown_is_rendered_with_raw_html_stripped_and_the_leading_h1_dropped(): void
    {
        $html = Articles::render("# Hair\n\n<script>alert(1)</script>\n\nBody.");
        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringNotContainsString('<h1>', $html);
        $this->assertStringContainsString('<p>Body.</p>', $html);
    }

    public function test_unsafe_link_targets_do_not_become_anchors(): void
    {
        $this->assertStringNotContainsString('<a href="javascript:', Articles::render('[a](javascript:alert(1))'));
        $this->assertStringContainsString('<a href="https://x.com"', Articles::render('[a](https://x.com)'));
        $this->assertStringContainsString('rel="noopener" target="_blank"', Articles::render('[a](https://x.com)'));
    }

    /**
     * Scheme-relative ("//host") reaches any host exactly like a bare host would, so it must be
     * rejected the same as javascript:/data: — matches markdown.ts's SAFE_TARGET, which core-js
     * uses for the same purpose.
     */
    public function test_a_scheme_relative_target_does_not_become_an_anchor(): void
    {
        $html = Articles::render('[a](//evil.example)');
        $this->assertStringNotContainsString('<a href="//evil.example"', $html);
        $this->assertStringContainsString('>a<', $html);
    }

    public function test_a_relative_and_a_fragment_link_are_kept(): void
    {
        $this->assertStringContainsString('<a href="/relative"', Articles::render('[a](/relative)'));
        $this->assertStringContainsString('<a href="#frag"', Articles::render('[a](#frag)'));
    }

    public function test_an_unsafe_image_target_is_dropped_entirely(): void
    {
        $html = Articles::render('![alt](javascript:alert(1))');
        $this->assertStringNotContainsString('<img', $html);
    }

    public function test_the_meta_description_falls_back_to_the_introduction(): void
    {
        $rows = Articles::toRows($this->payload(), ['en', 'ar']);
        $this->assertSame('A lede.', $rows['articles'][0]['metaDescription']);
        $this->assertSame([], $rows['skipped']);
    }

    public function test_spec_one_fields_without_a_column_are_kept(): void
    {
        $row = Articles::toRows($this->payload(), ['en'])['articles'][0];
        $this->assertSame('Dr B', $row['extra']['reviewer']['name']);
        $this->assertSame(['cost'], $row['extra']['secondaryKeywords']);
    }

    public function test_an_unsupported_language_is_skipped(): void
    {
        $p = $this->payload();
        $p['articles'][] = array_merge($p['articles'][0], ['lang' => 'zz']);
        $this->assertSame(['zz'], Articles::toRows($p, ['en', 'ar'])['skipped']);
    }

    public function test_a_second_job_reusing_a_live_slug_is_a_409(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        $this->assertSame(200, Articles::ingest($store, $this->payload(), ['en', 'ar'])['status']);
        $out = Articles::ingest($store, $this->payload(['externalId' => 10]), ['en', 'ar']);
        $this->assertSame(409, $out['status']);
        $this->assertSame('slug_taken', $out['body']['error']);
    }

    public function test_a_re_ingest_of_the_same_external_id_updates_rather_than_duplicates(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        Articles::ingest($store, $this->payload(), ['en', 'ar']);
        $changed = $this->payload();
        $changed['articles'][0]['title'] = 'Hair, revised';
        $out = Articles::ingest($store, $changed, ['en', 'ar']);
        $this->assertSame(200, $out['status']);
        $this->assertSame('Hair, revised', $store->findArticleBySlug('en', 'hair')['title']);
        $this->assertCount(1, $store->listArticles());
    }

    public function test_the_on_article_hook_takes_over_and_can_set_the_status(): void
    {
        config()->set('seo-runtime.on_article', fn (array $payload) => [
            'status' => 422, 'error' => 'publication_gate', 'results' => [], 'skipped' => [],
        ]);
        $out = Articles::ingest($this->store(), $this->payload(), ['en', 'ar']);
        $this->assertSame(422, $out['status']);
        $this->assertSame('publication_gate', $out['body']['error']);
    }

    public function test_an_on_article_hook_that_throws_is_a_500_not_a_crash(): void
    {
        config()->set('seo-runtime.on_article', function () {
            throw new \RuntimeException('cms down');
        });
        $out = Articles::ingest($this->store(), $this->payload(), ['en', 'ar']);
        $this->assertSame(500, $out['status']);
        $this->assertSame('article_hook_failed', $out['body']['error']);
    }
}
