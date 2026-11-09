PRAGMA foreign_keys = ON;
CREATE TABLE contents (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('post','page')), version INTEGER NOT NULL DEFAULT 1, draft_id TEXT NOT NULL, published_id TEXT, published_at TEXT, trashed_at TEXT, updated_at TEXT NOT NULL, mutation TEXT NOT NULL);
CREATE TABLE revisions (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, title TEXT NOT NULL, slug TEXT NOT NULL, summary TEXT NOT NULL, markdown TEXT NOT NULL, seo_title TEXT NOT NULL, seo_description TEXT NOT NULL, image TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX revisions_content ON revisions(content_id);
CREATE TABLE routes (path TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, live INTEGER NOT NULL DEFAULT 0);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, size INTEGER NOT NULL, alt TEXT NOT NULL, etag TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE previews (token_hash TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE VIRTUAL TABLE search_index USING fts5(content_id UNINDEXED, title, summary, markdown, tokenize='unicode61');
