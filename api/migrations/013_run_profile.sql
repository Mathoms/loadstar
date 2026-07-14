-- Snapshot the load profile onto each run at creation time.
-- A run's profile is a property of the test AS IT WAS when the run started —
-- if someone later edits the test's VU count, historical runs must not
-- retroactively claim the new value. NULL means "created before this migration"
-- and must be reported as unknown, never assumed comparable.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS profile JSONB;
