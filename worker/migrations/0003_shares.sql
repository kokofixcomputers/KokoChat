-- Run once on databases created before sharing existed:
--   npx wrangler d1 execute kokochat --remote --file=./migrations/0003_shares.sql
CREATE TABLE IF NOT EXISTS shares (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title   TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER,
  views   INTEGER NOT NULL DEFAULT 0,
  size    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shares_user ON shares (user_id);
