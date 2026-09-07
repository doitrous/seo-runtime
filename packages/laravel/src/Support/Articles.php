<?php

namespace Doitrous\SeoRuntime\Support;

use Doitrous\SeoRuntime\Store\EloquentStore;
use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\MarkdownConverter;

/** The port of articles.ts and markdown.ts. */
class Articles
{
    public const ARTICLE_PATH_DEFAULT = '/{lang}/blog/{slug}';

    /** Where this site serves an article. Config, never a constant — no two sites agree. */
    public static function articlePath(): callable
    {
        $configured = config('seo-runtime.article_path');

        return is_callable($configured) ? $configured : fn (string $lang, string $slug) => "/$lang/blog/$slug";
    }

    /**
     * Rejected only when the slug cannot sit in a URL path segment. Deliberately NOT kebab-case:
     * the sites serve Arabic slugs and the hub has been sending them since spec 1.
     */
    private static function badSlug(string $slug): bool
    {
        return $slug === ''
            || mb_strlen($slug) > 191
            || preg_match('#[\s/\\\\?\#]#u', $slug) === 1
            || str_contains($slug, '..');
    }

    /** validatePayload in articles.ts — identical error strings, checked by the suite. */
    public static function validate(mixed $body): array
    {
        if (!is_array($body) || !is_int($body['externalId'] ?? null)) return ['error' => 'invalid externalId'];
        if (!is_array($body['articles'] ?? null) || !$body['articles']) return ['error' => 'invalid articles'];
        foreach (array_values($body['articles']) as $i => $a) {
            if (!is_array($a)) return ['error' => "invalid articles[$i].lang"];
            foreach (['lang', 'title', 'slug', 'bodyMd'] as $k) {
                if (!is_string($a[$k] ?? null) || trim($a[$k]) === '') return ['error' => "invalid articles[$i].$k"];
            }
            if (self::badSlug(trim($a['slug']))) return ['error' => "invalid articles[$i].slug"];
            if (mb_strlen($a['title']) > 500) return ['error' => "invalid articles[$i].title"];
            foreach ($a['faq'] ?? [] as $f) {
                if (!is_array($f) || !is_string($f['q'] ?? null) || !is_string($f['a'] ?? null)) return ['error' => "invalid articles[$i].faq"];
            }
            foreach ($a['references'] ?? [] as $r) {
                if (!is_array($r) || !is_string($r['url'] ?? null)) return ['error' => "invalid articles[$i].references"];
            }
        }
        if (isset($body['image']) && $body['image'] !== null && !is_string($body['image']['url'] ?? null)) return ['error' => 'invalid image'];

        return ['payload' => $body];
    }

    /**
     * The same allowlist markdown.ts's `safeMarked` uses: `https://` or `http://`, a single-slash
     * relative path (not `//`, which is scheme-relative and reaches any host), or a `#` fragment.
     * CommonMark's own `allow_unsafe_links: false` allows `//host` through — it treats "no
     * scheme" as safe — so this method disables that built-in check and is the sole authority.
     */
    private const SAFE_TARGET = '~^(https?://|/(?!/)|#)~i';

    /** Unwraps (link) or drops (image) any target that fails SAFE_TARGET, after rendering. */
    private static function dropUnsafeTargets(string $html): string
    {
        $html = preg_replace_callback('#<a\s+href="([^"]*)"([^>]*)>(.*?)</a>#is', function (array $m) {
            $target = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5);

            return preg_match(self::SAFE_TARGET, $target) === 1 ? $m[0] : $m[3];
        }, $html) ?? $html;

        return preg_replace_callback('#<img\s+src="([^"]*)"[^>]*/?>#i', function (array $m) {
            $target = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5);

            return preg_match(self::SAFE_TARGET, $target) === 1 ? $m[0] : '';
        }, $html) ?? $html;
    }

    /**
     * The same renderer-level guard the JS packages use (markdown.ts's `safeMarked`): raw HTML is
     * escaped rather than emitted — CommonMark's `html_input: escape` covers every spelling of a
     * raw tag, block or inline, after the parser has unwrapped CommonMark's `<...>` link
     * destinations — and `dropUnsafeTargets` above is what actually enforces the target allowlist.
     */
    public static function render(string $md): string
    {
        $md = preg_replace('/^\s*# .*\n?/', '', $md, 1) ?? $md;
        $environment = new Environment(['html_input' => 'escape', 'allow_unsafe_links' => true]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $html = (string) (new MarkdownConverter($environment))->convert($md);
        $html = self::dropUnsafeTargets($html);

        return preg_replace('#<a href="(https?://[^"]+)"#', '<a href="$1" rel="noopener" target="_blank"', $html) ?? $html;
    }

    /** intro() in markdown.ts: the first prose paragraph with markup stripped. */
    public static function intro(string $md): string
    {
        $body = preg_replace('/^\s*# .*\n?/', '', $md, 1) ?? $md;
        foreach (preg_split('/\n{2,}/', $body) as $block) {
            $p = trim($block);
            if ($p === '' || str_starts_with($p, '#')) continue;
            $p = preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $p) ?? $p;

            return trim(str_replace(['*', '_', '`'], '', $p));
        }

        return '';
    }

    /** Cuts at a word boundary, so a derived description never ends mid-word. */
    private static function clip(string $text, int $max): string
    {
        $t = trim($text);
        if (mb_strlen($t) <= $max) return $t;
        $cut = mb_substr($t, 0, $max);
        $space = mb_strrpos($cut, ' ');

        return rtrim($space !== false && $space > $max * 0.6 ? mb_substr($cut, 0, $space) : $cut, " ,;:.-");
    }

    /** toStoredArticles in articles.ts. */
    public static function toRows(array $payload, array $supported): array
    {
        $skipped = [];
        $rows = [];
        // Matches JS's `new Date().toISOString()`: UTC, millisecond precision, literal "Z".
        $now = now('UTC')->format('Y-m-d\TH:i:s.v\Z');
        foreach ($payload['articles'] as $a) {
            if (!in_array($a['lang'], $supported, true)) { $skipped[] = $a['lang']; continue; }
            $lede = trim($a['introduction'] ?? '') ?: self::intro($a['bodyMd']);
            $rows[] = [
                'externalId' => $payload['externalId'], 'lang' => $a['lang'], 'slug' => trim($a['slug']),
                'title' => $a['title'],
                'metaTitle' => trim($a['metaTitle'] ?? '') ?: $a['title'],
                'metaDescription' => trim($a['metaDescription'] ?? '') ?: self::clip($lede, 155),
                'bodyMd' => $a['bodyMd'], 'bodyHtml' => self::render($a['bodyMd']),
                'faq' => $a['faq'] ?? [], 'schemaJsonld' => $a['schemaJsonld'] ?? [],
                'imageUrl' => $payload['image']['url'] ?? null, 'imageAlt' => $payload['image']['alt'] ?? null,
                'authorName' => $payload['author']['name'] ?? null,
                'authorCredentials' => $payload['author']['credentials'] ?? null,
                'references' => array_map(fn ($r) => ['title' => $r['title'] ?? '', 'url' => $r['url']], $a['references'] ?? []),
                'og' => [
                    'title' => $a['og']['title'] ?? '', 'description' => $a['og']['description'] ?? '',
                    'image' => $payload['image']['url'] ?? '',
                ],
                // Every spec-1 field with no column of its own. Dropping these would lose exactly
                // what spec 1 added, for any site whose articles live in this store.
                'extra' => array_filter([
                    'reviewer' => $payload['reviewer'] ?? null, 'reviewedAt' => $payload['reviewedAt'] ?? null,
                    'checklist' => $payload['checklist'] ?? null, 'cta' => $payload['cta'] ?? null,
                    'plannedUpdateAt' => $payload['plannedUpdateAt'] ?? null,
                    'secondaryKeywords' => $a['secondaryKeywords'] ?? null, 'searchIntent' => $a['searchIntent'] ?? null,
                    'sections' => $a['sections'] ?? null, 'introduction' => $a['introduction'] ?? null,
                ], fn ($v) => $v !== null),
                'publishedAt' => $now, 'updatedAt' => $now,
            ];
        }

        return ['skipped' => $skipped, 'articles' => $rows];
    }

    /** ingestArticles in articles.ts, including the 409 and the on_article hook contract. */
    public static function ingest(EloquentStore $store, mixed $body, array $supported): array
    {
        $v = self::validate($body);
        if (isset($v['error'])) return ['status' => 400, 'body' => ['error' => $v['error']]];

        $hook = config('seo-runtime.on_article');
        if (is_callable($hook)) {
            try {
                $out = (array) $hook($v['payload']);
                $status = $out['status'] ?? 200;
                unset($out['status']);

                return ['status' => $status, 'body' => $out];
            } catch (\Throwable $e) {
                report($e);

                return ['status' => 500, 'body' => ['error' => 'article_hook_failed', 'message' => $e->getMessage()]];
            }
        }

        ['skipped' => $skipped, 'articles' => $rows] = self::toRows($v['payload'], $supported);
        if (!$rows) return ['status' => 400, 'body' => ['error' => 'no supported languages']];

        foreach ($rows as $row) {
            $clash = $store->findArticleBySlug($row['lang'], $row['slug']);
            if ($clash && $clash['externalId'] !== $row['externalId']) {
                return ['status' => 409, 'body' => ['error' => 'slug_taken', 'slug' => $row['slug'], 'lang' => $row['lang']]];
            }
        }

        $settings = $store->getSettings() ?? Snapshot::EMPTY_SETTINGS;
        $articlePath = self::articlePath();
        $results = [];
        foreach ($rows as $row) {
            $store->upsertArticle($row);
            $results[] = [
                'lang' => $row['lang'], 'remoteId' => $row['externalId'] . ':' . $row['lang'],
                // The language's own base URL, not just the first configured one —
                // Snapshot::absoluteUrl already carries that fallback for a language with none.
                'remoteUrl' => Snapshot::absoluteUrl($settings, $row['lang'], $articlePath($row['lang'], $row['slug'])),
            ];
        }

        return ['status' => 200, 'body' => ['results' => $results, 'skipped' => $skipped]];
    }
}
