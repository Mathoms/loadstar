-- Worker heartbeat.
--
-- WHY: the controller is itself a worker AND IT BLOCKS while coordinating. So a
-- test needing N shards needs N+1 workers. With fewer, the shard rows are created
-- and NOBODY IS LEFT TO CLAIM THEM — a guaranteed deadlock that took 153 seconds to
-- report as "timeout: 0/2 shards done". Loadstar had no way to know how many
-- generators existed, so it could not refuse.
--
-- A DB heartbeat (rather than a container count or an env var) is deliberate: it is
-- exactly how generators on OTHER MACHINES announce themselves, which is what D2
-- (bring-your-own-boxes) requires. This is the first real piece of it.
CREATE TABLE IF NOT EXISTS workers (
  id          TEXT PRIMARY KEY,        -- hostname; stable per container
  kind        TEXT NOT NULL DEFAULT 'http',
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Counting live workers is on the hot path of every distributed run.
CREATE INDEX IF NOT EXISTS workers_last_seen_idx ON workers (last_seen);
