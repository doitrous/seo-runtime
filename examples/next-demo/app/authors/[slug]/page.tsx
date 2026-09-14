import { notFound } from 'next/navigation'
import { EMPTY_SETTINGS, absoluteUrl, findAuthor, personJsonLd, authorBodyHtml } from '@omary98/seo-runtime-core'
import { SeoJsonLd } from '@omary98/seo-runtime-next'
import { seo } from '@/lib/seo'

async function load(slug: string) {
  const settings = (await seo.config.store.getSettings()) ?? EMPTY_SETTINGS
  const author = findAuthor(settings, slug)
  if (!author) return null
  const lang = seo.config.supported?.[0] ?? 'en'
  const path = `/authors/${author.slug}`
  const resolved = await seo.resolve(path, lang)
  const jsonld = [...resolved.jsonld, personJsonLd(author, absoluteUrl(settings, lang, path))]
  return { author, resolved: { ...resolved, jsonld } }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loaded = await load(slug)
  if (!loaded) return {}
  return seo.metadata({ path: `/authors/${slug}`, lang: seo.config.supported?.[0] ?? 'en' })
}

export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loaded = await load(slug)
  if (!loaded) notFound()
  return (
    <>
      <main dangerouslySetInnerHTML={{ __html: authorBodyHtml(loaded.author) }} />
      <SeoJsonLd seo={loaded.resolved} />
    </>
  )
}
