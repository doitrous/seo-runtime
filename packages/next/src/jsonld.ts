import { createElement, type ReactElement } from 'react'
import type { ResolvedSeo } from '@doitrous/seo-runtime-core'
import { jsonLdScript } from '@doitrous/seo-runtime-core'

/**
 * Plain `.ts`, not `.tsx`: `node --test --experimental-strip-types` cannot load a `.tsx` file at
 * all (`ERR_UNKNOWN_FILE_EXTENSION`, JSX syntax or not), and `handlers.test.ts` pulls this module
 * in transitively through `index.ts`'s re-export. `createElement` gets the same rendered `<div>`
 * without JSX syntax for the test runner to choke on.
 *
 * `ReactElement`, not the brief's `JSX.Element`: with no JSX syntax in this file, TS never pulls
 * in the `react/jsx-runtime` types that (in @types/react 19) define the `JSX` namespace, so
 * `JSX.Element` doesn't resolve here. `ReactElement` is what `JSX.Element` aliases to anyway.
 *
 * Escaping is core's `jsonLdScript` (`<` -> `\u003c`) -- never reimplemented here. It already
 * returns fully-formed `<script>...</script>` markup, so this renders that markup inside one real
 * element via `dangerouslySetInnerHTML` rather than nesting a second `<script>` wrapper around it.
 */
export function SeoJsonLd({ seo }: { seo: ResolvedSeo }): ReactElement {
  return createElement('div', {
    suppressHydrationWarning: true,
    dangerouslySetInnerHTML: { __html: jsonLdScript(seo.jsonld) },
  })
}
