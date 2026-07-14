-- Baseline comparison. A baseline is a run the user marks as "known good" —
-- the reference point for "did this deploy regress?".
--
-- Without this, run history is always the last N runs by date: if the last five
-- runs were all degraded, the AI compares broken to broken and reports "stable".
-- The baseline stays in the comparison set regardless of how bad recent runs are.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT FALSE;

-- Only one baseline per test: a partial unique index enforces it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_baseline_per_test
  ON runs (test_id) WHERE is_baseline;

-- Per-run override: compare THIS run against THAT specific run (CI: PR vs main),
-- without changing the test's persistent baseline.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS compare_to UUID REFERENCES runs(id) ON DELETE SET NULL;
