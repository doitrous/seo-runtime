import { createElement, Fragment, type ReactElement } from 'react'
import type { ResolvedSeo } from '@omary98/seo-runtime-core'
import { gtagSnippet, jsonLdBody, shareBlockHtml, webVitalsSnippet } from '@omary98/seo-runtime-core'

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

/** v2: the opt-in GA4 snippet, emitted only when `settings.ga4MeasurementId` is set. */
export function SeoGtag({ seo }: { seo: ResolvedSeo }): ReactElement | null {
  const html = gtagSnippet(seo.ga4MeasurementId)
  return html ? createElement('span', { dangerouslySetInnerHTML: { __html: html } }) : null
}

/**
 * v2: the opt-in web-vitals beacon. Unlike `SeoGtag`, this is never gated by a snapshot field —
 * a site includes `<SeoWebVitals />` itself wherever it wants a page instrumented, and it is
 * never rendered automatically from `<SeoJsonLd>`/metadata the way the gtag snippet effectively
 * is. See `webVitalsSnippet`'s own docblock (core-js/src/entities.ts) for why it never takes
 * this site's secret.
 */
export function SeoWebVitals(): ReactElement {
  return createElement('span', { dangerouslySetInnerHTML: { __html: webVitalsSnippet() } })
}

/**
 * 01-site-setup.md §5 / packages/CONTRACT.md: the share block, server-rendered (WhatsApp, X,
 * Facebook, LinkedIn, copy-link) so it works with no JS; the block's own inline script only
 * upgrades to `navigator.share()`. A site includes `<ShareBlock url={...} title={...} />` itself
 * under its content — Next never inserts it automatically the way Express/Laravel append it to
 * the pages they render, since Next site-template renders its own pages.
 */
export function ShareBlock({ url, title }: { url: string; title: string }): ReactElement {
  return createElement('div', { dangerouslySetInnerHTML: { __html: shareBlockHtml({ url, title }) } })
}
