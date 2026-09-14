import { SeoGtag, SeoJsonLd } from '@omary98/seo-runtime-next'
import { seo } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  return seo.metadata({ path: `/${lang}`, lang })
}

// Real content, not a placeholder: the conformance suite's readability.test.mjs (Phase 5) checks
// this exact page for >= 200 words of SSR text, exactly one <h1>, no skipped heading level, and
// a <main> wrapper — deliberately true of this copy rather than something the suite has to fake.
const COPY: Record<string, { intro: string; h2a: string; bodyA: string; h2b: string; bodyB: string }> = {
  en: {
    intro: `This page is the reference home for the seo-runtime Next demo. It exists to prove,
      end to end, that a single hub-authored snapshot can drive every rendered surface of a site:
      the page title and meta description, the canonical URL, the Open Graph and Twitter cards,
      the JSON-LD blocks, and the newer additions from this runtime's AI-readability work — a
      per-crawler robots policy, verified ownership meta tags, an analytics snippet, an IndexNow
      key file, and the author, help and tool page types. None of that content is hand-written in
      this repository; every one of those fields comes from whatever snapshot the most recent
      sync call applied to this site's store, which is exactly what the conformance suite
      exercises against this very page on every run.`,
    h2a: 'What the runtime renders here',
    bodyA: `Every tag inside the document head is generated the same way: seo.resolve reads the
      page record stored under this exact path and language, composeSeo turns that record plus
      the site's settings into a title, a description, a canonical link, a set of alternate
      language links, a robots directive and a list of JSON-LD blocks, and generateMetadata hands
      Next's own metadata API the result. Nothing on this page is written per route by hand; the
      same small set of functions renders whatever page the most recently synced snapshot happens
      to describe next, in whichever language a visitor asked for.`,
    h2b: 'Why word count and heading structure matter here',
    bodyB: `Search engines and AI answer engines alike reward pages that carry enough real,
      extractable text and a clean heading outline: a single top-level heading, and no jump from
      one heading level straight past its immediate child level to a deeper one. This page is
      deliberately written long enough, and structured plainly enough, to satisfy that bar on its
      own, not because the runtime enforces any particular prose length or heading shape, but
      because a demo built to prove AI-readability conformance ought to actually read well to a
      person and to a machine alike.`,
  },
  ar: {
    intro: `هذه هي الصفحة الرئيسية التوضيحية لتطبيق Next الذي يعرض حزمة seo-runtime. تأتي كل عناصر
      البيانات الوصفية والروابط والبيانات المنظمة من اللقطة (snapshot) التي أرسلها المحور (hub) عبر
      نقطة المزامنة، وليست مكتوبة داخل هذا الملف.`,
    h2a: 'اتجاه الكتابة',
    bodyA: `تستخدم هذه الصفحة اتجاه الكتابة من اليمين إلى اليسار توافقًا مع اللغة العربية، وتحمل
      بياناتها المنظمة الخاصة بها المستقلة عن أي صفحة أخرى في الموقع.`,
    h2b: '',
    bodyB: '',
  },
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const resolved = await seo.resolve(`/${lang}`, lang)
  const copy = COPY[lang] ?? COPY.en
  return (
    <main dir={lang === 'ar' ? 'rtl' : undefined}>
      <h1>{resolved.title}</h1>
      <p>{copy.intro}</p>
      {copy.h2a && <h2>{copy.h2a}</h2>}
      {copy.bodyA && <p>{copy.bodyA}</p>}
      {copy.h2b && <h2>{copy.h2b}</h2>}
      {copy.bodyB && <p>{copy.bodyB}</p>}
      <SeoJsonLd seo={resolved} />
      <SeoGtag seo={resolved} />
    </main>
  )
}
