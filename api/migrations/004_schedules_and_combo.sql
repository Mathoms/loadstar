-- Scheduled regression runs with webhook alerts, and combined runs
-- (a browser flow measured while a background load test hammers the same target).

CREATE TABLE IF NOT EXISTS schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id          UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  interval_minutes INT  NOT NULL,
  webhook_url      TEXT,                -- Slack/Discord/Teams-compatible: POST {"text": "..."}
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, last_run_at);

-- Browser-under-load: a browser test may have a hidden companion http load test.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS companion_test_id UUID REFERENCES tests(id);
ALTER TABLE tests ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE runs  ADD COLUMN IF NOT EXISTS companion_run_id UUID;
