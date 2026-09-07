import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SeoStore } from '../store.ts'
import type { Settings, Snapshot, SnapshotPage, StoredArticle, StoredRedirect } from '../types.ts'
import { normalizePath } from '../types.ts'

type State = { snapshot: Snapshot | null; articles: StoredArticle[]; hits: Record<string, number>; lastSyncAt: string | null }

const EMPTY: State = { snapshot: null, articles: [], hits: {}, lastSyncAt: null }

/**
 * Single-file store. Good for demos, single-container deployments and any site with no database
 * of its own; a site that already has one implements SeoStore over it instead.
 * ponytail: whole-file rewrite under an atomic rename. Fine at snapshot sizes; move to SqlStore
 * when a site has tens of thousands of pages.
 */
export class JsonFileStore implements SeoStore {
  private path: string
  constructor(path: string) { this.path = path }

  private read(): State {
    try { return { ...EMPTY, ...JSON.parse(readFileSync(this.path, 'utf8')) as State } } catch { return { ...EMPTY } }
  }
  private write(state: State): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, this.path)
  }

  async getSnapshot(): Promise<Snapshot | null> { return this.read().snapshot }

  async putSnapshot(snapshot: Snapshot): Promise<void> {
    const state = this.read()
    this.write({ ...state, snapshot, lastSyncAt: new Date().toISOString() })
  }

  async getSettings(): Promise<Settings | null> { return this.read().snapshot?.settings ?? null }

  async getPage(path: string, lang: string): Promise<SnapshotPage | null> {
    const p = normalizePath(path)
    return this.read().snapshot?.pages.find((x) => normalizePath(x.path) === p && x.lang === lang) ?? null
  }

  async listGroup(groupKey: string): Promise<SnapshotPage[]> {
    if (!groupKey) return []
    return this.read().snapshot?.pages.filter((x) => x.group === groupKey) ?? []
  }

  async getRedirect(path: string): Promise<StoredRedirect | null> {
    const p = normalizePath(path)
    return this.read().snapshot?.redirects.find((r) => normalizePath(r.source) === p && r.active) ?? null
  }

  async listArticles(lang?: string): Promise<StoredArticle[]> {
    const all = this.read().articles
    return lang ? all.filter((a) => a.lang === lang) : all
  }

  async findArticleBySlug(lang: string, slug: string): Promise<StoredArticle | null> {
    return this.read().articles.find((a) => a.lang === lang && a.slug === slug) ?? null
  }

  async upsertArticle(article: StoredArticle): Promise<StoredArticle> {
    const state = this.read()
    const i = state.articles.findIndex((a) => a.externalId === article.externalId && a.lang === article.lang)
    const publishedAt = i >= 0 ? state.articles[i].publishedAt : article.publishedAt
    const row = { ...article, publishedAt }
    if (i >= 0) state.articles[i] = row; else state.articles.push(row)
    this.write(state)
    return row
  }

  async incrementHit(source: string): Promise<void> {
    const state = this.read()
    state.hits[source] = (state.hits[source] ?? 0) + 1
    this.write(state)
  }

  async peekHits(): Promise<{ source: string; hits: number }[]> {
    return Object.entries(this.read().hits).filter(([, n]) => n > 0).map(([source, hits]) => ({ source, hits }))
  }

  async takeHits(reported: { source: string; hits: number }[]): Promise<void> {
    const state = this.read()
    for (const { source, hits } of reported) {
      state.hits[source] = Math.max(0, (state.hits[source] ?? 0) - hits)
    }
    this.write(state)
  }

  async lastSyncAt(): Promise<string | null> { return this.read().lastSyncAt }
}
