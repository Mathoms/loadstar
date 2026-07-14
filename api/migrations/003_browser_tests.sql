-- Browser (functional/UI) tests alongside HTTP load tests.
-- test_type: 'http' (JMeter load) | 'browser' (Playwright flows)
-- browser_steps: ordered array of no-code steps, e.g.
--   [{"action":"click","selector":"text=Sign in"},
--    {"action":"fill","selector":"#email","value":"a@b.com"},
--    {"action":"expect_text","value":"Welcome"}]
ALTER TABLE tests ADD COLUMN IF NOT EXISTS test_type TEXT NOT NULL DEFAULT 'http';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS browser_steps JSONB;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS browser_engine TEXT NOT NULL DEFAULT 'playwright';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS loops INT NOT NULL DEFAULT 1;
