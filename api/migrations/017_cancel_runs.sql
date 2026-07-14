-- Stop a running test. The worker cannot be signalled directly (no channel to it),
-- so cancellation is a flag the worker polls while the engine subprocess runs.
--
-- A cancelled run keeps whatever partial results it produced (that data is real)
-- but is marked 'cancelled' so it is never mistaken for a completed run. Note that
-- getRunHistory only selects status IN ('done','failed'), so cancelled runs are
-- automatically excluded from comparisons and cannot become a baseline.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_runs_cancel ON runs(id) WHERE cancel_requested;
