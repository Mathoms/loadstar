-- Loadstar initial schema
CREATE TABLE IF NOT EXISTS tests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  target_url    TEXT NOT NULL,
  method        TEXT NOT NULL DEFAULT 'GET',
  headers       JSONB NOT NULL DEFAULT '{}',
  body          TEXT,
  mode          TEXT NOT NULL DEFAULT 'load',        -- load | stress | spike | soak
  virtual_users INT  NOT NULL DEFAULT 10,
  ramp_up_secs  INT  NOT NULL DEFAULT 30,
  duration_secs INT  NOT NULL DEFAULT 120,
  engine        TEXT NOT NULL DEFAULT 'jmeter',      -- jmeter | k6 (k6 planned)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id       UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',      -- queued | running | done | failed
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error         TEXT,
  summary       JSONB,                               -- aggregated metrics
  timeseries    JSONB,                               -- per-second buckets
  ai_analysis   JSONB,                               -- Claude-generated report
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_test ON runs(test_id);

-- Anti-abuse: a domain must be verified before it can receive load.
CREATE TABLE IF NOT EXISTS verified_targets (
  domain      TEXT PRIMARY KEY,
  token       TEXT NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit trail (enterprise requirement, cheap to start now).
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL DEFAULT 'api-key:default',
  action     TEXT NOT NULL,
  entity     TEXT,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
