import { notFound } from 'next/navigation'
import { EMPTY_SETTINGS, absoluteUrl, findHelpEntry, helpArticleJsonLd, helpBodyHtml } from '@omary98/seo-runtime-core'
import { SeoJsonLd } from '@omary98/seo-runtime-next'
import { seo } from '@/lib/seo'

async function load(slug: string, lang: string) {
  const settings = (await seo.config.store.getSettings()) ?? EMPTY_SETTINGS
  const entry = findHelpEntry(settings, slug, lang)
  if (!entry) return null
  const path = `/help/${entry.slug}`
  const resolved = await seo.resolve(path, lang)
  const jsonld = [...resolved.jsonld, helpArticleJsonLd(entry, absoluteUrl(settings, lang, path))]
  return { entry, resolved: { ...resolved, jsonld } }
}

const langOf = (searchParams: { lang?: string }) => searchParams.lang ?? seo.config.supported?.[0] ?? 'en'

export async function generateMetadata(
  { params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> },
) {
  const { slug } = await params
  const lang = langOf(await searchParams)
  const loaded = await load(slug, lang)
  if (!loaded) return {}
  return seo.metadata({ path: `/help/${slug}`, lang })
}

export default async function HelpPage(
  { params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> },
) {
  const { slug } = await params
  const lang = langOf(await searchParams)
  const loaded = await load(slug, lang)
  if (!loaded) notFound()
  return (
    <>
      <main dir={lang === 'ar' ? 'rtl' : undefined} dangerouslySetInnerHTML={{ __html: helpBodyHtml(loaded.entry) }} />
      <SeoJsonLd seo={loaded.resolved} />
    </>
  )
}
