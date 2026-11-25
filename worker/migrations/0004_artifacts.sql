-- Run once on databases created before published artifacts existed:
--   npx wrangler d1 execute kokochat --remote --file=./migrations/0004_artifacts.sql
-- Page content lives in `blobs` under key 'artifact:<id>'.
CREATE TABLE IF NOT EXISTS artifacts (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ref     TEXT NOT NULL DEFAULT '',
  title   TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  views   INTEGER NOT NULL DEFAULT 0,
  size    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS artifacts_user ON artifacts (user_id);
