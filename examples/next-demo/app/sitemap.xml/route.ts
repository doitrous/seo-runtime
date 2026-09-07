import { seo } from '@/lib/seo'

export const dynamic = 'force-dynamic'
export const GET = () => seo.sitemapResponse()
