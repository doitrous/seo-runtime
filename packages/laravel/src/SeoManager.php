<?php

namespace Doitrous\SeoRuntime;

use Doitrous\SeoRuntime\Store\EloquentStore;
use Doitrous\SeoRuntime\Support\Articles;
use Doitrous\SeoRuntime\Support\Sitemap;
use Doitrous\SeoRuntime\Support\Snapshot;

class SeoManager
{
    public const VERSION = '0.1.0';

    public function __construct(private EloquentStore $store) {}

    public function snapshot(): ?array { return $this->store->getSnapshot(); }

    public function apply(mixed $incoming): array
    {
        return Snapshot::apply($this->store, $incoming);
    }

    public function resolve(string $path, string $lang): array
    {
        return Snapshot::resolve($this->store, $path, $lang);
    }

    public function head(string $path, string $lang): string
    {
        return view('seo-runtime::head', ['seo' => $this->resolve($path, $lang)])->render();
    }

    public function redirect(string $path): ?array
    {
        // No `?? ['/api', '/admin']` fallback: matchRedirect itself unions the default reserved
        // prefixes into whatever is passed, so `reservedPrefixes: []` from the hub can never
        // unreserve them.
        $reserved = $this->store->getSettings()['reservedPrefixes'] ?? [];

        return Snapshot::matchRedirect($path, $this->store, $reserved);
    }

    // No page argument: phase 1 ships a single /sitemap.xml, no sitemap index (packages/CONTRACT.md).
    public function sitemapXml(): string { return Sitemap::xml($this->store); }

    public function robotsTxt(): string { return Sitemap::robots($this->store->getSnapshot()); }

    public function pages(): array { return Snapshot::providerPages($this->store); }

    public function health(): array { return Snapshot::health($this->store, self::VERSION, (string) config('seo-runtime.slug', '')); }

    public function ingest(mixed $payload): array
    {
        return Articles::ingest($this->store, $payload, (array) config('seo-runtime.supported', ['en']));
    }

    /** The hourly ping. Hits are drained only after the hub answers 2xx. */
    public function sendHealth(): bool
    {
        $hub = rtrim((string) config('seo-runtime.hub_url', ''), '/');
        $secret = (string) config('seo-runtime.secret', '');
        if ($hub === '' || $secret === '') return false;
        $body = $this->health();
        if ($body['siteSlug'] === '') return false;
        try {
            $res = \Illuminate\Support\Facades\Http::withToken($secret)->post("$hub/api/runtime/health", $body);
            if (!$res->successful()) return false;
            $this->store->takeHits($body['redirectHits']);

            return true;
        } catch (\Throwable $e) {
            report($e);

            return false;
        }
    }

    /** The boot pull and the 6-hourly pull. */
    public function pull(): string
    {
        $hub = rtrim((string) config('seo-runtime.hub_url', ''), '/');
        $secret = (string) config('seo-runtime.secret', '');
        $slug = (string) config('seo-runtime.slug', '') ?: ($this->store->getSnapshot()['siteSlug'] ?? '');
        if ($hub === '' || $secret === '' || $slug === '') return 'failed';
        try {
            $res = \Illuminate\Support\Facades\Http::withToken($secret)->get("$hub/api/sites/" . urlencode($slug) . '/snapshot');
            if (!$res->successful()) return 'failed';
            $out = $this->apply($res->json());

            return $out['status'] === 'invalid' ? 'failed' : $out['status'];
        } catch (\Throwable $e) {
            report($e);

            return 'failed';
        }
    }
}
