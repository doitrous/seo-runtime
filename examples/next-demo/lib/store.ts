// Shared by both `lib/seo.ts` (server-only, holds the runtime instance) and `proxy.ts` (Next 16's
// proxy convention, Node.js runtime): the store alone is what a proxy needs, so it lives in its
// own module rather than being re-exported off the runtime instance.
import { JsonFileStore } from '@doitrous/seo-runtime-core'

export const store = new JsonFileStore(process.env.DEMO_STATE ?? './.seo-runtime.json')
