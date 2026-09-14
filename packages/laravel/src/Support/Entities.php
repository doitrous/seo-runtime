<?php

namespace Doitrous\SeoRuntime\Support;

/**
 * The PHP port of core-js's entities.ts. Every method here has a named counterpart in the JS;
 * when the two disagree, the conformance suite is the arbiter (see packages/CONTRACT.md).
 * v2 fields (authors, helpEntries, tools, verification, indexNowKey, ga4MeasurementId,
 * crawlerPolicy, entity) all live inside `settings` — no migration needed on this stack either.
 */
class Entities
{
    public static function findAuthor(array $settings, string $slug): ?array
    {
        foreach ($settings['authors'] ?? [] as $a) if (($a['slug'] ?? null) === $slug) return $a;

        return null;
    }

    public static function findHelpEntry(array $settings, string $slug, string $lang): ?array
    {
        foreach ($settings['helpEntries'] ?? [] as $h) if (($h['slug'] ?? null) === $slug && ($h['lang'] ?? null) === $lang) return $h;

        return null;
    }

    public static function findTool(array $settings, string $slug, string $lang): ?array
    {
        foreach ($settings['tools'] ?? [] as $t) if (($t['slug'] ?? null) === $slug && ($t['lang'] ?? null) === $lang) return $t;

        return null;
    }

    public static function personJsonLd(array $author, string $canonical): array
    {
        $out = ['@context' => 'https://schema.org', '@type' => 'Person', '@id' => "$canonical#person", 'name' => $author['name'], 'url' => $canonical];
        if (!empty($author['title'])) $out['jobTitle'] = $author['title'];
        if (!empty($author['credentials'])) $out['honorificSuffix'] = $author['credentials'];
        if (!empty($author['bio'])) $out['description'] = $author['bio'];
        if (!empty($author['sameAs'])) $out['sameAs'] = $author['sameAs'];

        return $out;
    }

    public static function helpArticleJsonLd(array $entry, string $canonical): array
    {
        $out = [
            '@context' => 'https://schema.org', '@type' => 'Article', '@id' => "$canonical#article",
            'headline' => $entry['question'], 'url' => $canonical, 'mainEntityOfPage' => $canonical,
            'inLanguage' => $entry['lang'], 'dateModified' => $entry['updatedAt'],
        ];
        if (!empty($entry['moneyPageUrl'])) $out['about'] = $entry['moneyPageUrl'];

        return $out;
    }

    public static function toolJsonLd(array $tool, string $canonical): array
    {
        $out = [
            '@context' => 'https://schema.org', '@type' => 'WebApplication', '@id' => "$canonical#tool",
            'name' => $tool['kind'], 'url' => $canonical, 'applicationCategory' => $tool['kind'], 'inLanguage' => $tool['lang'],
        ];
        if (!empty($tool['dataSource'])) $out['creator'] = ['@type' => 'Organization', 'name' => $tool['dataSource']];
        if (!empty($tool['asOf'])) $out['dateModified'] = $tool['asOf'];

        return $out;
    }

    public static function authorBodyHtml(array $author): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $html = '<h1>' . $e($author['name']) . '</h1>';
        if (!empty($author['title'])) $html .= '<p class="seo-author-title">' . $e($author['title']) . '</p>';
        if (!empty($author['credentials'])) $html .= '<p class="seo-author-credentials">' . $e($author['credentials']) . '</p>';
        if (!empty($author['bio'])) $html .= '<p class="seo-author-bio">' . $e($author['bio']) . '</p>';
        if (!empty($author['sameAs'])) {
            $html .= '<ul class="seo-author-same-as">';
            foreach ($author['sameAs'] as $u) $html .= '<li><a href="' . $e($u) . '" rel="me">' . $e($u) . '</a></li>';
            $html .= '</ul>';
        }

        return $html;
    }

    /** Question as `<h1>`, answer first — `answerHtml` is pre-rendered, trusted HTML from the hub. */
    public static function helpBodyHtml(array $entry): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $html = '<h1>' . $e($entry['question']) . '</h1><div class="seo-help-answer">' . $entry['answerHtml'] . '</div>';
        if (!empty($entry['moneyPageUrl'])) $html .= '<p class="seo-help-cta"><a href="' . $e($entry['moneyPageUrl']) . '">Learn more</a></p>';

        return $html;
    }

    public static function toolBodyHtml(array $tool): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $config = json_encode($tool['config'] ?? [], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $html = '<h1>' . $e($tool['kind']) . '</h1>'
            . '<div id="seo-tool-' . $e($tool['slug']) . '" class="seo-tool-placeholder" data-kind="' . $e($tool['kind']) . '" data-config="' . $e($config) . '"></div>';
        if (!empty($tool['methodologyHtml'])) $html .= '<div class="seo-tool-methodology">' . $tool['methodologyHtml'] . '</div>';
        if (!empty($tool['dataSource'])) {
            $html .= '<p class="seo-tool-data-source">Data source: ' . $e($tool['dataSource']) . (!empty($tool['asOf']) ? ' (as of ' . $e($tool['asOf']) . ')' : '') . '</p>';
        }

        return $html;
    }

    public static function verificationMetaTags(?array $v): string
    {
        if (!$v) return '';
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $html = '';
        if (!empty($v['googleMeta'])) $html .= '<meta name="google-site-verification" content="' . $e($v['googleMeta']) . '">';
        if (!empty($v['bingMeta'])) $html .= '<meta name="msvalidate.01" content="' . $e($v['bingMeta']) . '">';

        return $html;
    }

    /** Dropped rather than escaped when malformed: the id sits inside a JS string literal, not an attribute. */
    public static function gtagSnippet(?string $measurementId): string
    {
        if (!$measurementId || preg_match('/^[A-Za-z0-9_-]+$/', $measurementId) !== 1) return '';

        return '<script async src="https://www.googletagmanager.com/gtag/js?id=' . $measurementId . '"></script>'
            . "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}"
            . "gtag('js',new Date());gtag('config','$measurementId');</script>";
    }

    /** `/{key}.txt` served with the key as the body, or null when `path` doesn't match. */
    public static function indexNowKeyFile(array $settings, string $path): ?string
    {
        $key = $settings['indexNowKey'] ?? null;
        if (!$key) return null;

        return Snapshot::normalizePath($path) === "/$key.txt" ? $key : null;
    }

    /**
     * The opt-in web-vitals beacon: a site includes this itself (never wired into head.blade.php
     * the way gtagSnippet is, since not every site wants a beacon on every page) and it never
     * carries this site's own secret — a real visitor's browser is not a place to keep one. It
     * posts LCP/CLS/best-effort INP to this site's own same-origin `POST /api/seo/vitals`, which
     * attaches the secret server-side and relays to the hub (SeoManager::vitals). No `web-vitals`
     * dependency: every metric comes straight off `PerformanceObserver`, which is all that
     * library wraps for these three entry types.
     */
    public static function webVitalsSnippet(): string
    {
        return '<script>(function(){try{'
            . "var m={lcp:0,inp:0,cls:0};"
            . "try{new PerformanceObserver(function(l){var es=l.getEntries();if(es.length)m.lcp=es[es.length-1].startTime;})"
            . ".observe({type:'largest-contentful-paint',buffered:true});}catch(e){}"
            . "try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)m.cls+=e.value;});})"
            . ".observe({type:'layout-shift',buffered:true});}catch(e){}"
            . "try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.duration>m.inp)m.inp=e.duration;});})"
            . ".observe({type:'event',buffered:true,durationThreshold:40});}catch(e){}"
            . "function send(){try{navigator.sendBeacon('/api/seo/vitals',JSON.stringify({url:location.href,lcp:m.lcp,inp:m.inp,cls:m.cls}));}catch(e){}}"
            . "document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')send();});"
            . 'addEventListener("pagehide",send);'
            . '}catch(e){}})();</script>';
    }
}
