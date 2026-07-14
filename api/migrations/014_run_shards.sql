-- Distributed runs: one parent run fans out into N shard runs, each executed by
-- a separate generator. A shard IS a run (reuses all run machinery) that points
-- at its parent via shard_of. All columns are nullable and additive — a normal
-- run leaves them NULL and behaves exactly as before.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS shard_of       UUID REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS shard_index    INT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS shard_count    INT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS shard_snapshot JSONB;  -- generator writes histogram snapshot() here

-- The controller polls "are all my shards done?" often; this keeps that cheap
-- without bloating the index for the ~all runs that are not shards.
CREATE INDEX IF NOT EXISTS idx_runs_shard_of ON runs(shard_of) WHERE shard_of IS NOT NULL;
