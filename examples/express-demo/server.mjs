import express from 'express'
import { JsonFileStore } from '@omary98/seo-runtime-core'
import { seoRuntime } from '@omary98/seo-runtime-express'

const app = express()

// No express.json() mounted here: @omary98/seo-runtime-express reads its own request bodies
// (with the 2 MB ceiling enforced on the stream) for POST /api/seo/sync and POST /api/articles,
// so it works whether or not this app runs its own body parser.
seoRuntime({
  store: new JsonFileStore(process.env.DEMO_STATE ?? './.seo-runtime.json'),
  supported: ['en', 'ar'],
  version: '0.1.0',
  pages: async () => [{ key: 'home', type: 'page', lang: 'en', path: '/en', title: 'Home', updatedAt: '2026-09-01T00:00:00.000Z' }],
})(app)

app.get('/en', async (_req, res) =>
  res.type('html').send(await res.locals.injectHead('<html><head></head><body><h1>Home</h1></body></html>')))

app.listen(Number(process.env.PORT ?? 3102))
