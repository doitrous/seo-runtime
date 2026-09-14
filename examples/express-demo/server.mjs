import express from 'express'
import { JsonFileStore, resolveSeo } from '@omary98/seo-runtime-core'
import { injectHead, seoRuntime } from '@omary98/seo-runtime-express'

const app = express()

const store = new JsonFileStore(process.env.DEMO_STATE ?? './.seo-runtime.json')

// No express.json() mounted here: @omary98/seo-runtime-express reads its own request bodies
// (with the 2 MB ceiling enforced on the stream) for POST /api/seo/sync and POST /api/articles,
// so it works whether or not this app runs its own body parser.
seoRuntime({
  store,
  supported: ['en', 'ar'],
  version: '0.1.2',
  pages: async () => [
    { key: 'home-en', type: 'page', lang: 'en', path: '/en', title: 'Home', updatedAt: '2026-09-01T00:00:00.000Z' },
    { key: 'home-ar', type: 'page', lang: 'ar', path: '/ar', title: 'الرئيسية', updatedAt: '2026-09-01T00:00:00.000Z' },
  ],
})(app)

// Real content, not a placeholder: the conformance suite's readability.test.mjs (Phase 5) checks
// this exact page for >= 200 words of SSR text, exactly one <h1>, no skipped heading level, and
// a <main> wrapper — deliberately true of this copy rather than something the suite has to fake.
const HOME_EN = `<main>
<h1>Home</h1>
<p>This page is the reference home for the seo-runtime Express demo. It exists to prove, end to
end, that a single hub-authored snapshot can drive every rendered surface of a site: the page
title and meta description, the canonical URL, the Open Graph and Twitter cards, the JSON-LD
blocks, and the newer additions from this runtime's AI-readability work — a per-crawler robots
policy, verified ownership meta tags, an analytics snippet, an IndexNow key file, and the author,
help and tool page types. None of that content is hand-written in this repository; every one of
those fields comes from whatever snapshot the most recent sync call applied to this site's store,
which is exactly what the conformance suite exercises against this very page on every run.</p>
<h2>What the runtime renders here</h2>
<p>Every tag inside the document head is generated the same way: resolveSeo reads the page record
stored under this exact path and language, composeSeo turns that record plus the site's settings
into a title, a description, a canonical link, a set of alternate language links, a robots
directive and a list of JSON-LD blocks, and injectHead splices all of it into this otherwise
static HTML shell just before the closing head tag. Nothing on this page is written per route by
hand; the same small set of functions renders whatever page the most recently synced snapshot
happens to describe next, in whichever language a visitor asked for.</p>
<h2>Why word count and heading structure matter here</h2>
<p>Search engines and AI answer engines alike reward pages that carry enough real, extractable
text and a clean heading outline: a single top-level heading, and no jump from one heading level
straight past its immediate child level to a deeper one. This page is deliberately written long
enough, and structured plainly enough, to satisfy that bar on its own, not because the runtime
enforces any particular prose length or heading shape, but because a demo built to prove
AI-readability conformance ought to actually read well to a person and to a machine alike.</p>
</main>`

const HOME_AR = `<main dir="rtl">
<h1>الرئيسية</h1>
<p>هذه هي الصفحة الرئيسية التوضيحية لتطبيق Express الذي يعرض حزمة seo-runtime. تأتي كل عناصر
البيانات الوصفية والروابط والبيانات المنظمة من اللقطة (snapshot) التي أرسلها المحور (hub) عبر نقطة
المزامنة، وليست مكتوبة داخل هذا الملف. تستخدم هذه الصفحة اتجاه الكتابة من اليمين إلى اليسار توافقًا
مع اللغة العربية، وتحمل بياناتها المنظمة الخاصة بها المستقلة عن أي صفحة أخرى في الموقع.</p>
</main>`

app.get('/en', async (_req, res) =>
  res.type('html').send(await res.locals.injectHead(`<html><head></head><body>${HOME_EN}</body></html>`)))

// A dedicated resolveSeo(store, '/ar', 'ar') call rather than res.locals.injectHead: that helper
// resolves against `?lang=` (defaulting to 'en'), which would resolve this route's SEO in the
// wrong language whenever a request omits the query string — this route's language is never in
// doubt, so it is passed straight through instead of relying on a query param.
app.get('/ar', async (_req, res) => {
  const seo = await resolveSeo(store, '/ar', 'ar')
  res.type('html').send(injectHead(`<html><head></head><body>${HOME_AR}</body></html>`, seo))
})

app.listen(Number(process.env.PORT ?? 3102))
