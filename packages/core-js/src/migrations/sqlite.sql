CREATE TABLE IF NOT EXISTS seo_runtime_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  site_slug TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT
);
-- page_key, not `key`: KEY is a reserved word in MySQL and one of the four sites is MySQL.
-- The name is the same in all three dialects so one set of SQL strings serves all of them.
CREATE TABLE IF NOT EXISTS seo_runtime_pages (
  page_key TEXT NOT NULL, type TEXT NOT NULL, lang TEXT NOT NULL, path TEXT NOT NULL,
  group_key TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '', seo TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (lang, path)
);
-- listGroup() is on the render path (hreflang alternates), so it gets an index.
CREATE INDEX IF NOT EXISTS seo_runtime_pages_group ON seo_runtime_pages (group_key);
CREATE TABLE IF NOT EXISTS seo_runtime_redirects (
  source TEXT PRIMARY KEY, destination TEXT NOT NULL,
  type INTEGER NOT NULL DEFAULT 301, active INTEGER NOT NULL DEFAULT 1, hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seo_runtime_articles (
  external_id INTEGER NOT NULL, lang TEXT NOT NULL, slug TEXT NOT NULL,
  title TEXT NOT NULL, meta_title TEXT NOT NULL DEFAULT '', meta_description TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '',
  faq TEXT NOT NULL DEFAULT '[]', schema_jsonld TEXT NOT NULL DEFAULT '[]',
  image_url TEXT, image_alt TEXT, author_name TEXT, author_credentials TEXT,
  refs TEXT NOT NULL DEFAULT '[]', og TEXT NOT NULL DEFAULT '{}',
  -- Every spec-1 payload field with no column of its own (reviewer, reviewedAt, checklist, cta,
  -- plannedUpdateAt, secondaryKeywords, searchIntent, sections, introduction).
  extra TEXT NOT NULL DEFAULT '{}',
  published_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (external_id, lang)
);
-- findArticleBySlug() runs on every ingest, to answer the 409.
CREATE INDEX IF NOT EXISTS seo_runtime_articles_slug ON seo_runtime_articles (lang, slug);
