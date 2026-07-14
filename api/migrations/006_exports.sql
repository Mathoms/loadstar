-- Report exports. HTML and PPTX are generated synchronously by the API;
-- PDF and email bundles are jobs executed by the browser worker (it has Chromium).
CREATE TABLE IF NOT EXISTS exports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  format     TEXT NOT NULL,                 -- 'pdf' | 'email_bundle'
  status     TEXT NOT NULL DEFAULT 'queued',-- queued | done | failed
  detail     JSONB NOT NULL DEFAULT '{}',   -- e.g. { "to": "boss@co.com" }
  file       BYTEA,
  filename   TEXT,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports(status);
