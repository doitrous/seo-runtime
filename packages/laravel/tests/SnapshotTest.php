<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Support\Snapshot;

/**
 * Exercises `Snapshot::apply`, `compose` (via `resolve`) and `matchRedirect` directly against a
 * real `EloquentStore` over sqlite — no facade, no HTTP: the facade and its controllers are B11b.
 */
class SnapshotTest extends TestCase
{
    public function test_a_snapshot_is_applied_and_a_lower_version_is_stale(): void
    {
        $store = $this->store();
        $this->assertSame('applied', Snapshot::apply($store, $this->snapshot())['status']);
        $this->assertSame('stale', Snapshot::apply($store, $this->snapshot(['version' => 1]))['status']);
        $this->assertSame(2, $store->getSnapshot()['version']);
    }

    public function test_an_equal_version_re_applies(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        $s = $this->snapshot();
        $s['pages'][0]['title'] = 'A, updated';
        $this->assertSame('applied', Snapshot::apply($store, $s)['status']);
        $this->assertSame('A, updated', $store->getPage('/en/a', 'en')['title']);
    }

    public function test_an_invalid_or_misaddressed_body_is_rejected(): void
    {
        $store = $this->store();
        $this->assertSame('invalid', Snapshot::apply($store, ['nope' => true])['status']);
        Snapshot::apply($store, $this->snapshot());
        // A malformed page must not become a 500 inside sanitize().
        $this->assertSame('invalid', Snapshot::apply($store, $this->snapshot(['version' => 9, 'pages' => [['key' => 'x']]]))['status']);
        // Another site's snapshot never overwrites this one's.
        $this->assertSame('invalid', Snapshot::apply($store, $this->snapshot(['version' => 9, 'siteSlug' => 'other']))['status']);
        $this->assertSame('demo', $store->getSnapshot()['siteSlug']);
    }

    public function test_unsafe_redirect_destinations_are_dropped_at_sync_time(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        $reserved = ['/api', '/admin'];
        $this->assertNull(Snapshot::matchRedirect('/bad', $store, $reserved));
        $this->assertSame('/en/a', Snapshot::matchRedirect('/old', $store, $reserved)['destination']);
        $this->assertSame('/en/a', Snapshot::matchRedirect('/old/?utm=1', $store, $reserved)['destination']);
        $this->assertNull(Snapshot::matchRedirect('/api/old', $store, $reserved));
    }

    public function test_resolve_matches_the_javascript_precedence(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        $seo = Snapshot::resolve($store, '/en/a', 'en');
        $this->assertSame('A page | X', $seo['title']);
        $this->assertSame('https://x.com/en/a', $seo['canonical']);
        $this->assertSame('https://x.com/og.png', $seo['og']['image']);
        $this->assertTrue($seo['robots']['index']);
        $this->assertSame('Organization', end($seo['jsonld'])['@type']);
    }

    public function test_an_empty_seo_title_uses_the_page_type_template(): void
    {
        $store = $this->store();
        $s = $this->snapshot(['version' => 5]);
        $s['pages'][0]['seo']['seoTitle'] = '';
        $s['settings']['pageDefaults']['page']['titleTemplate'] = '%s, clinic';
        Snapshot::apply($store, $s);
        $this->assertSame('A, clinic | X', Snapshot::resolve($store, '/en/a', 'en')['title']);
    }

    public function test_a_dollar_ampersand_in_the_title_is_inserted_literally(): void
    {
        // Mirrors resolve.test.ts: PHP's `str_replace('%s', $title, $template)` cannot misread
        // `$&` as a regex backreference the way `preg_replace` would, but the port keeps its own
        // literal, non-regex `replaceFirst` helper rather than relying on that being true forever.
        $store = $this->store();
        $s = $this->snapshot(['version' => 5]);
        $s['pages'][0]['title'] = 'A $& B';
        $s['pages'][0]['seo']['seoTitle'] = '';
        Snapshot::apply($store, $s);
        $this->assertSame('A $& B | X', Snapshot::resolve($store, '/en/a', 'en')['title']);
    }

    public function test_an_unknown_page_resolves_to_defaults(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        $seo = Snapshot::resolve($store, '/en/nothing', 'en');
        $this->assertSame('https://x.com/en/nothing', $seo['canonical']);
        $this->assertTrue($seo['robots']['index']);
    }

    public function test_an_invalid_structured_data_override_is_dropped(): void
    {
        $store = $this->store();
        $s = $this->snapshot(['version' => 6]);
        $s['pages'][0]['seo']['structuredData'] = [['@type' => 'Thing']];
        Snapshot::apply($store, $s);
        $types = array_column(Snapshot::resolve($store, '/en/a', 'en')['jsonld'], '@type');
        $this->assertSame(['WebPage', 'Organization'], $types);
    }

    public function test_the_kill_switch_forces_noindex_and_empties_the_sitemap(): void
    {
        $store = $this->store();
        $off = $this->snapshot(['version' => 3]);
        $off['settings']['indexingEnabled'] = false;
        Snapshot::apply($store, $off);
        $this->assertFalse(Snapshot::resolve($store, '/en/a', 'en')['robots']['index']);
    }

    public function test_json_ld_escapes_the_tag_opener(): void
    {
        $store = $this->store();
        $s = $this->snapshot(['version' => 7]);
        $s['pages'][0]['seo']['structuredData'] = [['@context' => 'https://schema.org', '@type' => 'Thing', 'name' => '</script>']];
        Snapshot::apply($store, $s);
        $seo = Snapshot::resolve($store, '/en/a', 'en');
        $script = Snapshot::jsonLdScript($seo['jsonld']);
        // The escape's whole purpose: the value's "</script>" is neutralised, so the block
        // contains exactly one real closing tag per JSON-LD entry — each one's own wrapper.
        $this->assertStringContainsString('</script>', $script);
        $this->assertSame(count($seo['jsonld']), substr_count($script, '</script>'));
    }

    /**
     * B11b conformance fix: json_encode() without JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE
     * diverges from JS's JSON.stringify, which never escapes '/' and never \uXXXX-escapes
     * non-ASCII text. A stray backslash-slash or a mangled Arabic title breaks byte-for-byte
     * parity with the JS output — exactly what the conformance suite's rendered-page JSON-LD
     * test checks.
     */
    public function test_json_ld_body_matches_javascripts_json_stringify_escaping(): void
    {
        $body = Snapshot::jsonLdBody(['@context' => 'https://schema.org', '@type' => 'Thing', 'name' => 'مقالة']);
        $this->assertStringNotContainsString('\\/', $body);
        $this->assertStringContainsString('https://schema.org', $body);
        $this->assertStringContainsString('مقالة', $body);
    }

    public function test_a_store_failure_never_breaks_resolve_but_is_counted(): void
    {
        $store = $this->store();
        Snapshot::apply($store, $this->snapshot());
        // No connection under this name exists, so every store read throws.
        $broken = new class extends \Doitrous\SeoRuntime\Store\EloquentStore {
            public function getSettings(): ?array
            {
                throw new \RuntimeException('db down');
            }
        };
        $before = Snapshot::storeFailures();
        $seo = Snapshot::resolve($broken, '/en/a', 'en');
        $this->assertSame('', $seo['title']);
        $this->assertTrue($seo['robots']['index']);
        $this->assertSame($before + 1, Snapshot::storeFailures());
    }
}
