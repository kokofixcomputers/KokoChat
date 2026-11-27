-- Published charts and diagrams, beside HTML pages.
ALTER TABLE artifacts ADD COLUMN kind TEXT NOT NULL DEFAULT 'html';
