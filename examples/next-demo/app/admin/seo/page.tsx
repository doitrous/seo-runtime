import { readConfig, timingSafeSecret } from '@omary98/seo-runtime-core'
import { SeoApprovalPanel } from '@omary98/seo-runtime-next/approval-panel'

/**
 * A demo host page for the approval panel. Secret-protected the same way `/seo-admin` is on the
 * Express package: a query string, since a plain browser visit can't set a custom header — treat
 * the URL like a password, never link to it publicly. `dynamic = 'force-dynamic'` because the
 * secret check depends on the request's own query string, not on anything cacheable.
 */
export const dynamic = 'force-dynamic'

export default async function SeoAdminPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  if (!timingSafeSecret(secret ?? '', readConfig().secret)) return <p>unauthorized</p>
  return <SeoApprovalPanel secret={secret ?? ''} />
}
