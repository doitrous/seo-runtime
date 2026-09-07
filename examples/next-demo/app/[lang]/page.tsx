import { SeoJsonLd } from '@doitrous/seo-runtime-next'
import { seo } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  return seo.metadata({ path: `/${lang}`, lang })
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const resolved = await seo.resolve(`/${lang}`, lang)
  return (
    <main>
      <h1>{resolved.title}</h1>
      <SeoJsonLd seo={resolved} />
    </main>
  )
}
