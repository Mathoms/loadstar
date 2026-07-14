/**
 * SLA evaluation — turns thresholds into a hard pass/fail for CI/CD gating.
 * Returns null when no SLA is set, else { passed, checks: [{name, ok, actual, limit}] }.
 */
export function evaluateSla(sla, summary) {
  if (!sla || typeof sla !== "object") return null;
  const checks = [];
  const add = (name, actual, limit, ok) =>
    actual != null && limit != null && checks.push({ name, actual, limit, ok });

  add("p95 ≤ " + sla.max_p95_ms + "ms", summary?.p95_ms, sla.max_p95_ms, summary?.p95_ms <= sla.max_p95_ms);
  add("error rate ≤ " + sla.max_error_rate + "%", summary?.error_rate, sla.max_error_rate, summary?.error_rate <= sla.max_error_rate);
  add("throughput ≥ " + sla.min_throughput_rps + " rps", summary?.throughput_rps, sla.min_throughput_rps, summary?.throughput_rps >= sla.min_throughput_rps);
  add("pass rate ≥ " + sla.min_pass_rate + "%", summary?.pass_rate, sla.min_pass_rate, summary?.pass_rate >= sla.min_pass_rate);
  add("avg flow ≤ " + sla.max_avg_flow_ms + "ms", summary?.avg_flow_ms, sla.max_avg_flow_ms, summary?.avg_flow_ms <= sla.max_avg_flow_ms);

  if (!checks.length) return null;
  return { passed: checks.every((c) => c.ok), checks };
}
