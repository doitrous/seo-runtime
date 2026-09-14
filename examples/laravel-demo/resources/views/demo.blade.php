<!doctype html>
<html lang="{{ $lang }}" dir="{{ $lang === 'ar' ? 'rtl' : 'ltr' }}">
<head>
@seoHead('/' . $lang, $lang)
</head>
<body>
{{--
  Real content, not a placeholder: the conformance suite's readability.test.mjs (Phase 5) checks
  the /en page for >= 200 words of SSR text, exactly one <h1>, no skipped heading level, and a
  <main> wrapper — deliberately true of this copy rather than something the suite has to fake.
--}}
@if ($lang === 'ar')
<main dir="rtl">
<h1>الرئيسية</h1>
<p>هذه هي الصفحة الرئيسية التوضيحية لتطبيق Laravel الذي يعرض حزمة seo-runtime. تأتي كل عناصر
البيانات الوصفية والروابط والبيانات المنظمة من اللقطة (snapshot) التي أرسلها المحور (hub) عبر نقطة
المزامنة، وليست مكتوبة داخل هذا الملف. تستخدم هذه الصفحة اتجاه الكتابة من اليمين إلى اليسار توافقًا
مع اللغة العربية، وتحمل بياناتها المنظمة الخاصة بها المستقلة عن أي صفحة أخرى في الموقع.</p>
</main>
@else
<main>
<h1>Home</h1>
<p>This page is the reference home for the seo-runtime Laravel demo. It exists to prove, end to
end, that a single hub-authored snapshot can drive every rendered surface of a site: the page
title and meta description, the canonical URL, the Open Graph and Twitter cards, the JSON-LD
blocks, and the newer additions from this runtime's AI-readability work — a per-crawler robots
policy, verified ownership meta tags, an analytics snippet, an IndexNow key file, and the author,
help and tool page types. None of that content is hand-written in this repository; every one of
those fields comes from whatever snapshot the most recent sync call applied to this site's store,
which is exactly what the conformance suite exercises against this very page on every run.</p>
<h2>What the runtime renders here</h2>
<p>Every tag inside the document head is generated the same way: Seo::head reads the page record
stored under this exact path and language, Snapshot::compose turns that record plus the site's
settings into a title, a description, a canonical link, a set of alternate language links, a
robots directive and a list of JSON-LD blocks, and @@seoHead splices all of it into this view's
head section. Nothing on this page is written per route by hand; the same small set of functions
renders whatever page the most recently synced snapshot happens to describe next, in whichever
language a visitor asked for.</p>
<h2>Why word count and heading structure matter here</h2>
<p>Search engines and AI answer engines alike reward pages that carry enough real, extractable
text and a clean heading outline: a single top-level heading, and no jump from one heading level
straight past its immediate child level to a deeper one. This page is deliberately written long
enough, and structured plainly enough, to satisfy that bar on its own, not because the runtime
enforces any particular prose length or heading shape, but because a demo built to prove
AI-readability conformance ought to actually read well to a person and to a machine alike.</p>
</main>
@endif
</body>
</html>
