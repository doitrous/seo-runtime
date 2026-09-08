CREATE TABLE IF NOT EXISTS seo_runtime_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version BIGINT NOT NULL DEFAULT 0,
  site_slug VARCHAR(191) NOT NULL DEFAULT '',
  settings JSON NOT NULL,
  -- ISO-8601 text, not DATETIME: the store writes `2026-09-08T06:00:00.000Z` and MySQL's DATETIME
  -- rejects the trailing Z in strict mode; the value is only ever echoed back to the hub.
  last_sync_at VARCHAR(40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- page_key, not `key`: KEY is a reserved word in MySQL and one of the four sites is MySQL.
-- The name is the same in all three dialects so one set of SQL strings serves all of them.
-- listGroup() is on the render path (hreflang alternates), so group_key gets an index; MySQL has
-- no CREATE INDEX IF NOT EXISTS, so both indexes are declared inline instead.
CREATE TABLE IF NOT EXISTS seo_runtime_pages (
  page_key VARCHAR(191) NOT NULL, type VARCHAR(191) NOT NULL, lang VARCHAR(191) NOT NULL, path VARCHAR(191) NOT NULL,
  group_key VARCHAR(191) NOT NULL DEFAULT '', title VARCHAR(191) NOT NULL DEFAULT '',
  updated_at VARCHAR(191) NOT NULL DEFAULT '', seo JSON NOT NULL,
  PRIMARY KEY (lang, path),
  KEY seo_runtime_pages_group (group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS seo_runtime_redirects (
  source VARCHAR(191) PRIMARY KEY, destination VARCHAR(1000) NOT NULL,
  type INTEGER NOT NULL DEFAULT 301, active TINYINT(1) NOT NULL DEFAULT 1, hits INTEGER NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS seo_runtime_articles (
  external_id INTEGER NOT NULL, lang VARCHAR(191) NOT NULL, slug VARCHAR(191) NOT NULL,
  -- Matches validatePayload's 500-char title ceiling and the Laravel/WordPress column widths;
  -- a valid hub payload must not become a MySQL strict-mode insert error on this stack alone.
  title VARCHAR(500) NOT NULL, meta_title VARCHAR(500) NOT NULL DEFAULT '', meta_description VARCHAR(1000) NOT NULL DEFAULT '',
  body_md MEDIUMTEXT, body_html MEDIUMTEXT,
  faq JSON NOT NULL, schema_jsonld JSON NOT NULL,
  image_url VARCHAR(191), image_alt VARCHAR(191), author_name VARCHAR(191), author_credentials VARCHAR(191),
  refs JSON NOT NULL, og JSON NOT NULL,
  -- Every spec-1 payload field with no column of its own (reviewer, reviewedAt, checklist, cta,
  -- plannedUpdateAt, secondaryKeywords, searchIntent, sections, introduction).
  extra JSON NOT NULL,
  published_at VARCHAR(191) NOT NULL DEFAULT '', updated_at VARCHAR(191) NOT NULL DEFAULT '',
  PRIMARY KEY (external_id, lang),
  -- findArticleBySlug() runs on every ingest, to answer the 409.
  KEY seo_runtime_articles_slug (lang, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
