<?php

namespace Doitrous\SeoRuntime;

use Doitrous\SeoRuntime\Store\EloquentStore;
use Doitrous\SeoRuntime\Support\Articles;
use Doitrous\SeoRuntime\Support\Entities;
use Doitrous\SeoRuntime\Support\Sitemap;
use Doitrous\SeoRuntime\Support\Snapshot;

class SeoManager
{
    public const VERSION = '0.1.4';

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

    /** v2 content pages, rendered by the package itself. Null when the slug (and lang) don't match. */
    public function author(string $slug): ?array
    {
        $settings = $this->store->getSettings() ?? Snapshot::EMPTY_SETTINGS;
        $author = Entities::findAuthor($settings, $slug);
        if (!$author) return null;
        $path = "/authors/{$author['slug']}";
        $lang = (array) config('seo-runtime.supported', ['en']);
        $lang = $lang[0] ?? 'en';
        $seo = $this->resolve($path, $lang);
        $seo['jsonld'][] = Entities::personJsonLd($author, Snapshot::absoluteUrl($settings, $lang, $path));

        return ['bodyHtml' => Entities::authorBodyHtml($author), 'seo' => $seo];
    }

    public function helpEntry(string $slug, string $lang): ?array
    {
        $settings = $this->store->getSettings() ?? Snapshot::EMPTY_SETTINGS;
        $entry = Entities::findHelpEntry($settings, $slug, $lang);
        if (!$entry) return null;
        $path = "/help/{$entry['slug']}";
        $seo = $this->resolve($path, $lang);
        $seo['jsonld'][] = Entities::helpArticleJsonLd($entry, Snapshot::absoluteUrl($settings, $lang, $path));

        return ['bodyHtml' => Entities::helpBodyHtml($entry), 'seo' => $seo];
    }

    public function tool(string $slug, string $lang): ?array
    {
        $settings = $this->store->getSettings() ?? Snapshot::EMPTY_SETTINGS;
        $tool = Entities::findTool($settings, $slug, $lang);
        if (!$tool) return null;
        $path = "/tools/{$tool['slug']}";
        $seo = $this->resolve($path, $lang);
        $seo['jsonld'][] = Entities::toolJsonLd($tool, Snapshot::absoluteUrl($settings, $lang, $path));

        return ['bodyHtml' => Entities::toolBodyHtml($tool), 'seo' => $seo];
    }

    /** `/{key}.txt` for IndexNow key verification, or null when `path` doesn't match. */
    public function indexNowKeyFile(string $path): ?string
    {
        return Entities::indexNowKeyFile($this->store->getSettings() ?? Snapshot::EMPTY_SETTINGS, $path);
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

    /** v2: pending/approve proxy. This site's own secret in (the site.secret middleware), the
     * hub's runtime secret out. `null` bodies/statuses mean "not configured" — the controller
     * turns that into a 502, same as the JS packages' `proxyPending`/`proxyApprovalAction`. */
    public function pending(): array
    {
        return $this->hubProxy('get', '/api/sites/' . urlencode($this->slugForProxy()) . '/pending');
    }

    public function approvalAction(string $action, string $jobId, string $approvedBy, ?string $note = null): array
    {
        if ($jobId === '' || $approvedBy === '') return ['status' => 400, 'body' => ['error' => 'invalid']];
        $path = '/api/sites/' . urlencode($this->slugForProxy()) . '/jobs/' . urlencode($jobId) . '/' . $action;

        return $this->hubProxy('post', $path, array_filter(['approvedBy' => $approvedBy, 'note' => $note], fn ($v) => $v !== null));
    }

    /**
     * v2: IndexNow. This site's own secret in (the site.secret middleware), then forwards
     * `urlList` to api.indexnow.org with settings.indexNowKey — the same key served at
     * `/{key}.txt` (indexNowKeyFile, above), which is what lets IndexNow's own key verification
     * succeed. Every URL must share the batch's host (IndexNow's own rule); a mismatched one is
     * dropped rather than sent, since IndexNow rejects the whole batch on a host mismatch.
     */
    public function indexNow(array $urlList): array
    {
        $settings = $this->store->getSettings() ?? Snapshot::EMPTY_SETTINGS;
        $key = $settings['indexNowKey'] ?? null;
        if (!$key) return ['status' => 502, 'body' => ['error' => 'misconfigured']];
        if (empty($urlList)) return ['status' => 400, 'body' => ['error' => 'invalid']];
        $host = parse_url((string) $urlList[0], PHP_URL_HOST);
        if (!$host) return ['status' => 400, 'body' => ['error' => 'invalid']];
        $urls = array_values(array_filter($urlList, fn ($u) => parse_url((string) $u, PHP_URL_HOST) === $host));
        if (empty($urls)) return ['status' => 400, 'body' => ['error' => 'invalid']];
        try {
            $res = \Illuminate\Support\Facades\Http::asJson()->post('https://api.indexnow.org/indexnow', [
                'host' => $host, 'key' => $key, 'keyLocation' => "https://$host/$key.txt", 'urlList' => $urls,
            ]);

            return ['status' => $res->status(), 'body' => $res->json() ?? $res->body()];
        } catch (\Throwable $e) {
            report($e);

            return ['status' => 502, 'body' => ['error' => 'indexnow_unreachable']];
        }
    }

    /**
     * v2: the opt-in web-vitals beacon (Entities::webVitalsSnippet) posts here with NO secret —
     * it runs in a real visitor's browser, which is not a place to keep this site's secret. The
     * secret is attached only on the way OUT, to the hub, via the same `hubProxy` every other
     * hub-proxy call in this class uses.
     */
    public function vitals(array $sample): array
    {
        $hub = rtrim((string) config('seo-runtime.hub_url', ''), '/');
        $secret = (string) config('seo-runtime.secret', '');
        if ($hub === '' || $secret === '') return ['status' => 502, 'body' => ['error' => 'misconfigured']];
        if (empty($sample['url'])) return ['status' => 400, 'body' => ['error' => 'invalid']];
        $slug = $this->slugForProxy();
        if ($slug === '') return ['status' => 502, 'body' => ['error' => 'misconfigured']];

        return $this->hubProxy('post', '/api/runtime/vitals', [
            'siteSlug' => $slug, 'url' => $sample['url'],
            'lcp' => $sample['lcp'] ?? null, 'inp' => $sample['inp'] ?? null, 'cls' => $sample['cls'] ?? null,
            'source' => 'rum',
        ]);
    }

    private function slugForProxy(): string
    {
        return (string) config('seo-runtime.slug', '') ?: (string) ($this->store->getSnapshot()['siteSlug'] ?? '');
    }

    private function hubProxy(string $method, string $path, array $body = []): array
    {
        $hub = rtrim((string) config('seo-runtime.hub_url', ''), '/');
        $secret = (string) config('seo-runtime.secret', '');
        $slug = $this->slugForProxy();
        if ($hub === '' || $secret === '' || $slug === '') return ['status' => 502, 'body' => ['error' => 'misconfigured']];
        try {
            $req = \Illuminate\Support\Facades\Http::withToken($secret);
            $res = $method === 'get' ? $req->get("$hub$path") : $req->post("$hub$path", $body);

            return ['status' => $res->status(), 'body' => $res->json() ?? $res->body()];
        } catch (\Throwable $e) {
            report($e);

            return ['status' => 502, 'body' => ['error' => 'hub_unreachable']];
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
