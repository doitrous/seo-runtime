CREATE TABLE IF NOT EXISTS seo_runtime_state (
  id integer PRIMARY KEY CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0,
  site_slug text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}',
  last_sync_at timestamptz
);
-- page_key, not `key`: KEY is a reserved word in MySQL and one of the four sites is MySQL.
-- The name is the same in all three dialects so one set of SQL strings serves all of them.
CREATE TABLE IF NOT EXISTS seo_runtime_pages (
  page_key text NOT NULL, type text NOT NULL, lang text NOT NULL, path text NOT NULL,
  group_key text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT '', seo jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (lang, path)
);
-- listGroup() is on the render path (hreflang alternates), so it gets an index.
CREATE INDEX IF NOT EXISTS seo_runtime_pages_group ON seo_runtime_pages (group_key);
CREATE TABLE IF NOT EXISTS seo_runtime_redirects (
  source text PRIMARY KEY, destination text NOT NULL,
  type integer NOT NULL DEFAULT 301, active boolean NOT NULL DEFAULT true, hits integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seo_runtime_articles (
  external_id integer NOT NULL, lang text NOT NULL, slug text NOT NULL,
  title text NOT NULL, meta_title text NOT NULL DEFAULT '', meta_description text NOT NULL DEFAULT '',
  body_md text NOT NULL DEFAULT '', body_html text NOT NULL DEFAULT '',
  faq jsonb NOT NULL DEFAULT '[]', schema_jsonld jsonb NOT NULL DEFAULT '[]',
  image_url text, image_alt text, author_name text, author_credentials text,
  refs jsonb NOT NULL DEFAULT '[]', og jsonb NOT NULL DEFAULT '{}',
  -- Every spec-1 payload field with no column of its own (reviewer, reviewedAt, checklist, cta,
  -- plannedUpdateAt, secondaryKeywords, searchIntent, sections, introduction).
  extra jsonb NOT NULL DEFAULT '{}',
  published_at text NOT NULL DEFAULT '', updated_at text NOT NULL DEFAULT '',
  PRIMARY KEY (external_id, lang)
);
-- findArticleBySlug() runs on every ingest, to answer the 409.
CREATE INDEX IF NOT EXISTS seo_runtime_articles_slug ON seo_runtime_articles (lang, slug);
