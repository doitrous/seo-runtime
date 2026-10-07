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
            if (array_key_exists('locale', $a) && $a['locale'] !== null) {
                // The language part must be the item's own language: `ar-AE` under `lang: 'ar'`.
                $loc = $a['locale'];
                $ok = is_string($loc) && (Locale::canonical($loc) === Locale::canonical($a['lang'])
                    || (Locale::isLocaleCode($loc) && Locale::langOf($loc) === Locale::langOf($a['lang'])));
                if (!$ok) return ['error' => "invalid articles[$i].locale"];
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

    /** The item's locale: its own `locale` when sent, else its `lang` (0.1.6 behaviour). */
    private static function itemLocale(array $a): string
    {
        return is_string($a['locale'] ?? null) && trim($a['locale']) !== '' ? Locale::canonical($a['locale']) : $a['lang'];
    }

    private static function hasLocale(array $a): bool
    {
        return is_string($a['locale'] ?? null) && trim($a['locale']) !== '';
    }

    /** toStoredArticles in articles.ts. */
    public static function toRows(array $payload, array $supported): array
    {
        $skipped = [];
        $rows = [];
        // Matches JS's `new Date().toISOString()`: UTC, millisecond precision, literal "Z".
        $now = now('UTC')->format('Y-m-d\TH:i:s.v\Z');
        // The lead of each language is its first item (the hub sends the source first, then
        // market order). A later item carrying the lead's own locale is the same version again.
        $leadLocale = [];
        foreach ($payload['articles'] as $a) {
            if (!in_array($a['lang'], $supported, true)) { $skipped[] = $a['lang']; continue; }
            $locale = self::itemLocale($a);
            $leadLocale[$a['lang']] ??= $locale;
            $lead = $leadLocale[$a['lang']] === $locale;
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
                'locale' => $locale, 'lead' => $lead, 'hreflang' => [],
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

        $settings = $store->getSettings() ?? Snapshot::EMPTY_SETTINGS;
        $urlOf = fn (array $a) => Snapshot::absoluteUrl($settings, $a['lang'], Locale::versionPath($a));

        // A slug that already belongs to a DIFFERENT job would publish a second article at the
        // same URL. Checked per URL space: a lead against its language's leads, any other version
        // against its own locale.
        foreach ($rows as $row) {
            $lead = Locale::isLead($row);
            $clash = $store->findArticleBySlug($lead ? $row['lang'] : $row['locale'], $row['slug']);
            if ($clash && $clash['externalId'] !== $row['externalId']) {
                return ['status' => 409, 'body' => ['error' => 'slug_taken', 'slug' => $row['slug'], 'lang' => $row['lang']]
                    + ($lead ? [] : ['locale' => $row['locale']])];
            }
        }

        // hreflang from every version this site holds for the externalId once this payload lands:
        // the payload's own versions first (the source is first), then any stored earlier.
        $incoming = [];
        foreach ($rows as $row) $incoming[$row['locale']] = $row;
        $incoming = array_values($incoming);
        $untouched = array_values(array_filter($store->listArticleVersions($v['payload']['externalId']), function (array $old) use ($incoming) {
            foreach ($incoming as $a) {
                if (Locale::localeOf($a) === Locale::localeOf($old)) return false;
                if (Locale::isLead($a) && Locale::isLead($old) && $a['lang'] === $old['lang']) return false;
            }

            return true;
        }));
        $legacy = true;
        foreach ($v['payload']['articles'] as $item) if (self::hasLocale($item)) $legacy = false;
        $hreflang = Locale::hreflang(array_merge($incoming, $untouched), $urlOf, $legacy);

        $results = [];
        foreach ($rows as $row) {
            $row['hreflang'] = $hreflang;
            $store->upsertArticle($row);
            $lead = Locale::isLead($row);
            $sent = null;
            foreach ($v['payload']['articles'] as $item) {
                if ($item['lang'] === $row['lang'] && self::itemLocale($item) === $row['locale']) { $sent = $item; break; }
            }
            $results[] = ['lang' => $row['lang']]
                // Only echoed when the hub sent one, so a 0.1.6-shaped payload gets a 0.1.6 answer.
                + ($sent !== null && self::hasLocale($sent) ? ['locale' => $sent['locale']] : [])
                + [
                    'remoteId' => $row['externalId'] . ':' . ($lead ? $row['lang'] : $row['locale']),
                    // The language's own base URL, not just the first configured one —
                    // Snapshot::absoluteUrl already carries that fallback for a language with none.
                    'remoteUrl' => $urlOf($row),
                ];
        }
        // Versions stored by an earlier payload keep their content; only their hreflang moves.
        foreach ($untouched as $old) {
            if (($old['hreflang'] ?? []) != $hreflang) $store->upsertArticle(array_merge($old, ['hreflang' => $hreflang]));
        }

        return ['status' => 200, 'body' => ['results' => $results, 'skipped' => $skipped]];
    }

    /**
     * getArticle in articles.ts — the host's article lookup for routing. `$langOrLocale` is the
     * first path segment (`ar` → that language's lead, `ar-ae`/`ar-AE` → that locale's version).
     * Null for an unknown slug, and for a locale that names its language's lead (the lead is
     * served at the language URL only; answering the locale URL too would duplicate it).
     */
    public static function find(EloquentStore $store, string $langOrLocale, string $slug): ?array
    {
        $key = trim($langOrLocale);
        if ($key === '' || $slug === '') return null;
        $a = $store->findArticleBySlug($key, $slug);
        if (!$a) return null;
        if (Locale::isLead($a)) return strtolower($a['lang']) === strtolower($key) ? $a : null;

        return Locale::localeOf($a) === Locale::canonical($key) ? $a : null;
    }
}
