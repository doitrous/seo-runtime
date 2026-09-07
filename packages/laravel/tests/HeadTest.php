<?php

namespace Doitrous\SeoRuntime\Tests;

use Doitrous\SeoRuntime\Seo;

/**
 * The head-rendering test B11's report deferred to B11b (its own
 * test_head_output_escapes_every_string had no renderer to exercise yet). Covers Seo::head(),
 * the @seoHead Blade directive and the JSON-LD escape surviving all the way through a real
 * Blade render — not just Snapshot::jsonLdScript() in isolation.
 */
class HeadTest extends FacadeTestCase
{
    public function test_head_output_escapes_every_string(): void
    {
        $store = $this->store();
        $snapshot = $this->snapshot();
        $snapshot['pages'][0]['title'] = '<b>A</b> & "quoted"';
        $snapshot['pages'][0]['seo']['seoTitle'] = '<b>A</b> & "quoted"';
        $store->putSnapshot($snapshot);

        $html = Seo::head('/en/a', 'en');

        $this->assertStringNotContainsString('<b>A</b>', $html);
        $this->assertStringContainsString('&lt;b&gt;A&lt;/b&gt;', $html);
        $this->assertStringContainsString('&quot;quoted&quot;', $html);
    }

    public function test_head_embeds_escaped_json_ld(): void
    {
        $store = $this->store();
        $snapshot = $this->snapshot();
        $snapshot['pages'][0]['seo']['structuredData'] = [
            ['@context' => 'https://schema.org', '@type' => 'WebPage', 'name' => '</script><script>alert(1)</script>'],
        ];
        $store->putSnapshot($snapshot);

        $html = Seo::head('/en/a', 'en');

        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString('</script>', $html);
        $this->assertStringContainsString('<script type="application/ld+json">', $html);
    }

    public function test_seo_head_blade_directive_renders_the_same_output(): void
    {
        $store = $this->store();
        $store->putSnapshot($this->snapshot());

        $rendered = \Illuminate\Support\Facades\Blade::render("@seoHead('/en/a', 'en')");

        $this->assertSame(Seo::head('/en/a', 'en'), $rendered);
    }
}
