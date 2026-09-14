import { notFound } from 'next/navigation'
import { EMPTY_SETTINGS, absoluteUrl, findTool, toolBodyHtml, toolJsonLd } from '@omary98/seo-runtime-core'
import { SeoJsonLd } from '@omary98/seo-runtime-next'
import { seo } from '@/lib/seo'

async function load(slug: string, lang: string) {
  const settings = (await seo.config.store.getSettings()) ?? EMPTY_SETTINGS
  const tool = findTool(settings, slug, lang)
  if (!tool) return null
  const path = `/tools/${tool.slug}`
  const resolved = await seo.resolve(path, lang)
  const jsonld = [...resolved.jsonld, toolJsonLd(tool, absoluteUrl(settings, lang, path))]
  return { tool, resolved: { ...resolved, jsonld } }
}

const langOf = (searchParams: { lang?: string }) => searchParams.lang ?? seo.config.supported?.[0] ?? 'en'

export async function generateMetadata(
  { params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> },
) {
  const { slug } = await params
  const lang = langOf(await searchParams)
  const loaded = await load(slug, lang)
  if (!loaded) return {}
  return seo.metadata({ path: `/tools/${slug}`, lang })
}

export default async function ToolPage(
  { params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> },
) {
  const { slug } = await params
  const lang = langOf(await searchParams)
  const loaded = await load(slug, lang)
  if (!loaded) notFound()
  return (
    <>
      {/* The interactive kit ships separately and mounts into #seo-tool-{slug}. */}
      <main dangerouslySetInnerHTML={{ __html: toolBodyHtml(loaded.tool) }} />
      <SeoJsonLd seo={loaded.resolved} />
    </>
  )
}
