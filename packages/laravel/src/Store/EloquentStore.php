<?php

namespace Doitrous\SeoRuntime\Store;

use Doitrous\SeoRuntime\Support\Snapshot;
use Illuminate\Support\Facades\DB;

class EloquentStore
{
    private function json(mixed $v, mixed $fallback = []): mixed
    {
        if (is_array($v)) return $v;

        return is_string($v) ? (json_decode($v, true) ?? $fallback) : $fallback;
    }

    private function toPage(object $row): array
    {
        return [
            'key' => $row->page_key, 'type' => $row->type, 'lang' => $row->lang, 'path' => $row->path,
            'group' => $row->group_key, 'title' => $row->title, 'updatedAt' => $row->updated_at,
            'seo' => $this->json($row->seo),
        ];
    }

    public function getSnapshot(): ?array
    {
        $state = DB::table('seo_runtime_state')->where('id', 1)->first();
        if (!$state) return null;

        return [
            'version' => (int) $state->version,
            'siteSlug' => $state->site_slug,
            'settings' => $this->json($state->settings),
            'pages' => DB::table('seo_runtime_pages')->get()->map(fn ($r) => $this->toPage($r))->all(),
            'redirects' => DB::table('seo_runtime_redirects')->get()->map(fn ($r) => [
                'source' => $r->source, 'destination' => $r->destination,
                'type' => (int) $r->type, 'active' => (bool) $r->active,
            ])->all(),
        ];
    }

    /** One row, not the whole store: this is what resolve() reads on every render. */
    public function getSettings(): ?array
    {
        $state = DB::table('seo_runtime_state')->where('id', 1)->first();

        return $state ? $this->json($state->settings) : null;
    }

    public function putSnapshot(array $s): void
    {
        DB::transaction(function () use ($s) {
            DB::table('seo_runtime_pages')->delete();
            DB::table('seo_runtime_redirects')->delete();
            DB::table('seo_runtime_state')->delete();
            DB::table('seo_runtime_state')->insert([
                'id' => 1, 'version' => $s['version'], 'site_slug' => $s['siteSlug'],
                'settings' => json_encode($s['settings']), 'last_sync_at' => now(),
            ]);
            foreach (array_chunk($s['pages'], 200) as $chunk) {
                DB::table('seo_runtime_pages')->insert(array_map(fn ($p) => [
                    'page_key' => $p['key'], 'type' => $p['type'], 'lang' => $p['lang'],
                    'path' => Snapshot::normalizePath($p['path']), 'group_key' => $p['group'],
                    'title' => $p['title'], 'updated_at' => $p['updatedAt'], 'seo' => json_encode($p['seo']),
                ], $chunk));
            }
            foreach (array_chunk($s['redirects'], 200) as $chunk) {
                DB::table('seo_runtime_redirects')->insert(array_map(fn ($r) => [
                    'source' => Snapshot::normalizePath($r['source']), 'destination' => $r['destination'],
                    'type' => $r['type'], 'active' => $r['active'], 'hits' => 0,
                ], $chunk));
            }
        });
    }

    public function getPage(string $path, string $lang): ?array
    {
        $row = DB::table('seo_runtime_pages')
            ->where('path', Snapshot::normalizePath($path))->where('lang', $lang)->first();

        return $row ? $this->toPage($row) : null;
    }

    public function listGroup(string $groupKey): array
    {
        if ($groupKey === '') return [];

        return DB::table('seo_runtime_pages')->where('group_key', $groupKey)
            ->get()->map(fn ($r) => $this->toPage($r))->all();
    }

    public function getRedirect(string $path): ?array
    {
        $row = DB::table('seo_runtime_redirects')
            ->where('source', Snapshot::normalizePath($path))->where('active', true)->first();

        return $row ? ['source' => $row->source, 'destination' => $row->destination, 'type' => (int) $row->type, 'active' => true] : null;
    }

    public function listArticles(?string $lang = null): array
    {
        $q = DB::table('seo_runtime_articles');
        if ($lang !== null) $q->where('lang', $lang);

        return $q->get()->map(fn ($r) => $this->toArticle($r))->all();
    }

    public function findArticleBySlug(string $lang, string $slug): ?array
    {
        $row = DB::table('seo_runtime_articles')->where('lang', $lang)->where('slug', $slug)->first();

        return $row ? $this->toArticle($row) : null;
    }

    private function toArticle(object $r): array
    {
        return [
            'externalId' => (int) $r->external_id, 'lang' => $r->lang, 'slug' => $r->slug, 'title' => $r->title,
            'metaTitle' => $r->meta_title, 'metaDescription' => $r->meta_description,
            'bodyMd' => $r->body_md, 'bodyHtml' => $r->body_html,
            'faq' => $this->json($r->faq), 'schemaJsonld' => $this->json($r->schema_jsonld),
            'imageUrl' => $r->image_url, 'imageAlt' => $r->image_alt,
            'authorName' => $r->author_name, 'authorCredentials' => $r->author_credentials,
            'references' => $this->json($r->refs), 'og' => $this->json($r->og, (object) []),
            'extra' => $this->json($r->extra), 'publishedAt' => $r->published_at, 'updatedAt' => $r->updated_at,
        ];
    }

    public function upsertArticle(array $a): array
    {
        $existing = DB::table('seo_runtime_articles')
            ->where('external_id', $a['externalId'])->where('lang', $a['lang'])->first();
        $a['publishedAt'] = $existing ? $existing->published_at : $a['publishedAt'];
        DB::table('seo_runtime_articles')->updateOrInsert(
            ['external_id' => $a['externalId'], 'lang' => $a['lang']],
            [
                'slug' => $a['slug'], 'title' => $a['title'], 'meta_title' => $a['metaTitle'],
                'meta_description' => $a['metaDescription'], 'body_md' => $a['bodyMd'], 'body_html' => $a['bodyHtml'],
                'faq' => json_encode($a['faq']), 'schema_jsonld' => json_encode($a['schemaJsonld']),
                'image_url' => $a['imageUrl'], 'image_alt' => $a['imageAlt'],
                'author_name' => $a['authorName'], 'author_credentials' => $a['authorCredentials'],
                'refs' => json_encode($a['references']), 'og' => json_encode($a['og']),
                'extra' => json_encode($a['extra']),
                'published_at' => $a['publishedAt'], 'updated_at' => $a['updatedAt'],
            ],
        );

        return $a;
    }

    public function incrementHit(string $source): void
    {
        DB::table('seo_runtime_redirects')->where('source', Snapshot::normalizePath($source))->increment('hits');
    }

    /** Read-only: GET /api/seo/health must not mutate. */
    public function peekHits(): array
    {
        return DB::table('seo_runtime_redirects')->where('hits', '>', 0)
            ->get(['source', 'hits'])->map(fn ($r) => ['source' => $r->source, 'hits' => (int) $r->hits])->all();
    }

    /** Subtracts what the hub acknowledged, so hits counted mid-request are not lost. */
    public function takeHits(array $reported): void
    {
        foreach ($reported as $hit) {
            DB::table('seo_runtime_redirects')
                ->where('source', Snapshot::normalizePath($hit['source']))
                ->update(['hits' => DB::raw('CASE WHEN hits > ' . (int) $hit['hits'] . ' THEN hits - ' . (int) $hit['hits'] . ' ELSE 0 END')]);
        }
    }

    public function lastSyncAt(): ?string
    {
        $state = DB::table('seo_runtime_state')->where('id', 1)->first();

        return $state?->last_sync_at ? (string) $state->last_sync_at : null;
    }
}
