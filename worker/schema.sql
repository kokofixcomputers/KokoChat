CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email   TEXT NOT NULL,
  salt    TEXT NOT NULL,
  created INTEGER NOT NULL,
  quota_bytes INTEGER,                      -- per-user override (NULL = default quota)
  disabled    INTEGER NOT NULL DEFAULT 0,   -- suspended by an admin
  last_login  INTEGER,
  last_sync   INTEGER
);

CREATE TABLE IF NOT EXISTS otp (
  email           TEXT PRIMARY KEY,
  code_hash       TEXT NOT NULL,
  expires         INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_sent       INTEGER NOT NULL,
  hour_start      INTEGER NOT NULL,
  sent_this_hour  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- One row per synced item. `size` is the payload size in bytes (counts towards the quota).
CREATE TABLE IF NOT EXISTS items (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key)
);

-- Public read-only chat shares (payload chunks live in `blobs` under key 'share:<id>').
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

-- Item payloads, split into chunks so a single item can exceed D1's 2 MB row limit.
CREATE TABLE IF NOT EXISTS blobs (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  rev     INTEGER NOT NULL,
  idx     INTEGER NOT NULL,
  chunk   TEXT NOT NULL,
  PRIMARY KEY (user_id, key, rev, idx)
);

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
