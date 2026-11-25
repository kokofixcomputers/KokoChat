-- Run once on databases created before the admin feature:
--   npx wrangler d1 execute kokochat --remote --file=./migrations/0002_admin.sql
ALTER TABLE users ADD COLUMN quota_bytes INTEGER;
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login INTEGER;
ALTER TABLE users ADD COLUMN last_sync INTEGER;
