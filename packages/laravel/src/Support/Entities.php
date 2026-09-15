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

    private static function toolPlaceholderDiv(array $tool): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $config = json_encode($tool['config'] ?? [], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return '<div id="seo-tool-' . $e($tool['slug']) . '" class="seo-tool-placeholder" data-kind="' . $e($tool['kind']) . '" data-config="' . $e($config) . '"></div>';
    }

    /** Every kind's config carries a `title`; fall back to the slug (ported from site-template's `toolTitle`). */
    private static function toolTitle(array $tool): string
    {
        $title = $tool['config']['title'] ?? null;

        return is_string($title) && $title !== '' ? $title : $tool['slug'];
    }

    /**
     * The paste-anywhere snippet shown under a tool page — ported byte-for-byte from
     * site-template's `packages/tools/embed.ts` (core-js's `embedSnippet` is the JS twin) so
     * every stack's embed markup matches. The `<p>` outside the iframe is the point: a crawlable
     * link back to the tool page and the home page, since an iframe alone passes no link equity.
     * The tool link stays followed (editorial attribution); the brand link is a pure widget
     * credit and is `rel="nofollow"` per Google's link-spam policy. The `<script>` only resizes
     * an iframe pointed at this same origin — never an ad or chat widget.
     */
    public static function embedSnippet(string $origin, string $slug, string $lang, string $title, string $siteName): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        // The hub-supplied slug is untrusted: rawurlencode so a quote in it can never break out
        // of the src/href attribute it lands in below.
        $page = "$origin/tools/" . rawurlencode($slug);

        return implode("\n", [
            '<iframe src="' . $page . '/embed?lang=' . rawurlencode($lang) . '" title="' . $e($title) . '" width="100%" height="480" style="border:0;max-width:100%" loading="lazy"></iframe>',
            '<p><a href="' . $page . '">' . $e($title) . '</a> — a free tool by <a href="' . $origin . '/" rel="nofollow">' . $e($siteName) . '</a></p>',
            '<script>addEventListener("message",function(e){var h=Number(e.data&&e.data.seoToolHeight);if(!h)return;document.querySelectorAll(\'iframe[src^="' . $origin . '/"]\').forEach(function(f){if(f.contentWindow===e.source)f.style.height=h+"px"})})</script>',
        ]);
    }

    /**
     * A placeholder container plus the methodology block — the interactive kit itself ships
     * separately and mounts into `#seo-tool-{slug}` at runtime, via `/seo-tools.js` (the site
     * copies `public/seo-tools.js` from site-template; see the package README).
     *
     * `$origin`/`$siteName` default to '' so existing call sites keep compiling: on a cold store
     * there is no origin to build an absolute embed URL from, so the "Embed this calculator"
     * section is omitted entirely rather than emitting a broken relative iframe src.
     */
    public static function toolBodyHtml(array $tool, string $origin = '', string $siteName = ''): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $html = '<h1>' . $e($tool['kind']) . '</h1>' . self::toolPlaceholderDiv($tool);
        if (!empty($tool['methodologyHtml'])) $html .= '<div class="seo-tool-methodology">' . $tool['methodologyHtml'] . '</div>';
        if (!empty($tool['dataSource'])) {
            $html .= '<p class="seo-tool-data-source">Data source: ' . $e($tool['dataSource']) . (!empty($tool['asOf']) ? ' (as of ' . $e($tool['asOf']) . ')' : '') . '</p>';
        }
        if ($origin !== '') {
            $snippet = self::embedSnippet($origin, $tool['slug'], $tool['lang'], self::toolTitle($tool), $siteName);
            $html .= '<h2>Embed this calculator</h2><textarea readonly rows="6">' . $e($snippet) . '</textarea>';
        }

        return $html . '<script src="/seo-tools.js" defer></script>';
    }

    /**
     * The iframe-able view of a tool: the calculator placeholder, a link back to the full page,
     * the calculator bundle, and the inline ResizeObserver postMessage script — ported
     * byte-for-byte from site-template's `app/tools/[slug]/embed/page.tsx`. `target="_top"` on
     * the link so it navigates the host page, not the iframe.
     */
    public static function toolEmbedHtml(array $tool, string $canonical, string $siteName): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);

        return self::toolPlaceholderDiv($tool)
            . '<p><a href="' . $e($canonical) . '" target="_top">Full calculator, methodology and FAQ at ' . $e($siteName) . '</a></p>'
            . '<script src="/seo-tools.js" defer></script>'
            . '<script>new ResizeObserver(function(){parent.postMessage({seoToolHeight:document.documentElement.scrollHeight},\'*\')}).observe(document.body)</script>';
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
    /**
     * `/help` index (06-help-page.md): every entry for `$lang`, a client-side filter box, and a
     * FAQPage block for the first 10 questions. `HelpEntry` carries no topic field (that stays
     * hub-side, per the ticket), so "grouped" here is one flat, filterable list rather than the
     * topic buckets the doc sketches — a real grouping needs a hub field to group by.
     */
    public static function helpIndexBodyHtml(array $settings, string $lang): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $entries = array_values(array_filter($settings['helpEntries'] ?? [], fn ($h) => ($h['lang'] ?? null) === $lang));
        if ($entries) {
            // The slug and lang are hub-supplied strings, not developer-authored config:
            // rawurlencode first so a quote or `?`/`&` in either can never break out of the href
            // it lands in, then xmlEscape as usual for the HTML attribute itself (belt and
            // braces, same split embedSnippet uses for a tool slug).
            $items = implode('', array_map(fn ($h) => '<li><a href="' . $e('/help/' . rawurlencode($h['slug']) . '?lang=' . rawurlencode($lang)) . '">' . $e($h['question']) . '</a></li>', $entries));
            $list = '<ul class="seo-help-index">' . $items . '</ul>';
        } else {
            $list = '<p>No help entries yet.</p>';
        }
        $faq = array_map(fn ($h) => [
            '@type' => 'Question', 'name' => $h['question'],
            'acceptedAnswer' => ['@type' => 'Answer', 'text' => $h['answerHtml']],
        ], array_slice($entries, 0, 10));
        $faqJsonLd = $faq ? Snapshot::jsonLdScript([[
            '@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $faq,
        ]]) : '';

        return '<h1>Help</h1>'
            . '<input type="search" id="seo-help-search" placeholder="Search help" aria-label="Search help">'
            . $list
            . '<script>(function(){var i=document.getElementById("seo-help-search");var items=document.querySelectorAll(".seo-help-index li");'
            . 'if(!i)return;i.addEventListener("input",function(){var q=i.value.toLowerCase();'
            . 'items.forEach(function(li){li.hidden=q!==""&&li.textContent.toLowerCase().indexOf(q)===-1})})})();</script>'
            . $faqJsonLd;
    }

    /** `/editorial-guidelines` (01-site-setup.md). `editorialGuidelinesHtml` is pre-rendered, trusted HTML from the hub — rendered as-is, like a help entry's `answerHtml`. */
    public static function editorialBodyHtml(array $settings): string
    {
        $html = trim((string) ($settings['editorialGuidelinesHtml'] ?? ''));

        return '<h1>Editorial guidelines</h1>' . ($html !== '' ? $html : '<p>Editorial guidelines are not published yet.</p>');
    }

    /**
     * hreflang for the five locale-free routes this package renders itself (`/help`,
     * `/help/{slug}`, `/editorial-guidelines`, `/authors/{slug}`, `/tools/{slug}`): matched by
     * `?lang=`, not a path segment, so there is no stored page record to group alternates from.
     * `$path` is the bare path with no query. The current language's own URL stays the page's
     * canonical (computed separately by SeoManager::resolve); this only supplies the reciprocal
     * set. Never used on `/tools/{slug}/embed`, which stays canonical-only (noindex).
     */
    public static function localeFreeAlternates(array $supported, string $path): array
    {
        $p = Snapshot::normalizePath($path);
        $out = [];
        foreach ($supported as $lang) $out[$lang] = "$p?lang=" . rawurlencode($lang);
        if ($supported) $out['x-default'] = $out[$supported[0]];

        return $out;
    }

    /**
     * 01-site-setup.md §5 / packages/CONTRACT.md: server-rendered share links (WhatsApp, X,
     * Facebook, LinkedIn, copy-link) so the block works with no JS at all; the inline script only
     * upgrades the "Share" button to `navigator.share()` when the browser has it.
     */
    public static function shareBlockHtml(string $url, string $title): string
    {
        $e = fn ($s) => Sitemap::xmlEscape((string) $s);
        $u = rawurlencode($url);
        $t = rawurlencode($title);
        $links = [
            ['WhatsApp', "https://wa.me/?text=$t%20$u"],
            ['X', "https://twitter.com/intent/tweet?text=$t&url=$u"],
            ['Facebook', "https://www.facebook.com/sharer/sharer.php?u=$u"],
            ['LinkedIn', "https://www.linkedin.com/sharing/share-offsite/?url=$u"],
        ];
        $anchors = implode('', array_map(fn ($l) => '<a href="' . $l[1] . '" rel="noopener" target="_blank">' . $e($l[0]) . '</a>', $links));

        return '<div class="seo-share">'
            . '<button type="button" id="seo-share-native" hidden data-url="' . $e($url) . '" data-title="' . $e($title) . '">Share</button>'
            . $anchors
            . '<button type="button" data-share-copy="' . $e($url) . '">Copy link</button>'
            . '</div>'
            . '<script>(function(){var n=document.getElementById("seo-share-native");'
            . 'if(navigator.share&&n){n.hidden=false;n.addEventListener("click",function(){navigator.share({title:n.dataset.title,url:n.dataset.url}).catch(function(){})})}'
            . 'document.querySelectorAll("[data-share-copy]").forEach(function(b){b.addEventListener("click",function(){'
            . 'navigator.clipboard&&navigator.clipboard.writeText(b.dataset.shareCopy).catch(function(){})})})})();</script>';
    }

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
