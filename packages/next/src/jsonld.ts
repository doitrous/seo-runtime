import { createElement, Fragment, type ReactElement } from 'react'
import type { ResolvedSeo } from '@omary98/seo-runtime-core'
import { jsonLdBody } from '@omary98/seo-runtime-core'

/**
 * Plain `.ts`, not `.tsx`: `node --test --experimental-strip-types` cannot load a `.tsx` file, and
 * `handlers.test.ts` pulls this module in through `index.ts`. `ReactElement` is what `JSX.Element`
 * aliases to. One `<script type="application/ld+json">` per entry, no wrapper element, so the
 * component is valid inside `<head>` as well as `<body>`. Escaping is core's `jsonLdBody`.
 */
export function SeoJsonLd({ seo }: { seo: ResolvedSeo }): ReactElement {
  return createElement(
    Fragment,
    null,
    ...seo.jsonld.map((entry, i) =>
      createElement('script', { key: i, type: 'application/ld+json', dangerouslySetInnerHTML: { __html: jsonLdBody(entry) } }),
    ),
  )
}
