-- Cross-browser testing: which Playwright engine runs a functional test.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT 'chromium';
