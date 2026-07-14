/**
 * Webhook alerts for scheduled regression runs.
 * Sends a Slack/Discord/Teams-compatible JSON payload: { "text": "..." }.
 * Alerts fire only when a run is unhealthy: failed status, browser pass rate
 * below 100%, or http error rate above ALERT_ERROR_RATE_PCT (default 5%).
 */
import { isPrivateAddress } from "../middleware/security.js";

export function isValidWebhookUrl(url) {
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol)) return false;
    if (process.env.ALLOW_PRIVATE_TARGETS !== "true" && isPrivateAddress(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function unhealthy(run, summary) {
  if (run.status === "failed") return `run failed: ${run.error || "unknown error"}`;
  if (summary?.sla && summary.sla.passed === false) {
    const bad = summary.sla.checks.filter((c) => !c.ok).map((c) => `${c.name} (actual ${c.actual})`);
    return `SLA thresholds not met: ${bad.join("; ")}`;
  }
  const threshold = Number(process.env.ALERT_ERROR_RATE_PCT || 5);
  if (summary?.pass_rate != null && summary.pass_rate < 100)
    return `only ${summary.flows_passed}/${summary.flows_total} browser flows passed (${summary.pass_rate}%)`;
  if (summary?.error_rate != null && summary.error_rate > threshold)
    return `error rate ${summary.error_rate}% exceeded ${threshold}% (p95 ${summary.p95_ms}ms)`;
  return null;
}

export async function notifyRunResult(pool, test, run, summary) {
  const reason = unhealthy(run, summary);
  if (!reason) return;
  const q = await pool.query(
    "SELECT webhook_url FROM schedules WHERE test_id=$1 AND enabled AND webhook_url IS NOT NULL",
    [test.id]
  );
  if (!q.rows.length) return;
  const text = `⚠️ Loadstar alert — "${test.name}": ${reason}. Run ${run.id}.`;
  for (const { webhook_url } of q.rows) {
    if (!isValidWebhookUrl(webhook_url)) continue;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      await fetch(webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      console.log(`[alert] sent for test ${test.id}`);
    } catch (e) {
      console.warn(`[alert] webhook failed: ${e.message}`);
    }
  }
}
