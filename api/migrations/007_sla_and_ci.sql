-- SLA thresholds for CI/CD gating.
-- tests.sla example: {"max_p95_ms": 500, "max_error_rate": 1}  (http)
--                or: {"min_pass_rate": 100, "max_avg_flow_ms": 5000}  (browser)
ALTER TABLE tests ADD COLUMN IF NOT EXISTS sla JSONB;
ALTER TABLE runs  ADD COLUMN IF NOT EXISTS sla_passed BOOLEAN;  -- null = no SLA set
