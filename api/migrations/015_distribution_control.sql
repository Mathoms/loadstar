-- User control over distributed load. Defaults preserve current behaviour:
-- 'auto' = distribute above the VU threshold, as today.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS distribution_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (distribution_mode IN ('auto','on','off'));
ALTER TABLE tests ADD COLUMN IF NOT EXISTS shard_count_override INT;
