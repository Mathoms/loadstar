-- Debug-trace runs: when true, the run executes once (1 VU / 1 iteration) and
-- captures full request/response detail for inspecting auth flows. Never used
-- for load runs (capturing bodies at scale would be huge).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS debug BOOLEAN DEFAULT FALSE;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS debug_trace JSONB;
