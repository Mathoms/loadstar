import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://loadstar:loadstar@localhost:5432/loadstar",
  max: 10,
});

/** Run every .sql file in /migrations in filename order. Idempotent. */
export async function migrate() {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await pool.query(sql);
  }
  console.log(`[db] migrations applied: ${files.join(", ")}`);
}

export async function audit(actor, action, entity, detail = {}) {
  await pool.query(
    "INSERT INTO audit_log (actor, action, entity, detail) VALUES ($1,$2,$3,$4)",
    [actor, action, entity, JSON.stringify(detail)]
  );
}

/**
 * The load profile of a test AS EXECUTED. Snapshotted onto each run at
 * completion by the workers, so later edits to a test can never retroactively
 * rewrite what a historical run actually did.
 *
 * Counts and timing only — never headers or bodies, which routinely carry
 * auth tokens and would leak into AI prompts and stored history.
 */
export function loadProfile(test) {
  if (!test) return null;
  const p = { engine: test.engine || "jmeter", mode: test.mode || null };
  if (test.test_type === "browser") {
    p.users = test.virtual_users ?? null;
    p.loops = test.loops ?? null;
    p.steps = Array.isArray(test.browser_steps) ? test.browser_steps.length : 0;
    p.browser = test.browser || null;
    return p;
  }
  p.virtual_users = test.virtual_users ?? null;
  p.duration_secs = test.duration_secs ?? null;
  p.ramp_up_secs = test.ramp_up_secs ?? null;
  const reqs = Array.isArray(test.requests) ? test.requests : [];
  p.requests = reqs.length || 1;
  const tt = reqs.filter((r) => Number(r.think_time_ms) > 0);
  if (tt.length) {
    const ms = [...new Set(tt.map((r) => Number(r.think_time_ms)))].join("/");
    const jit = [...new Set(tt.map((r) => Number(r.think_time_jitter_pct) || 0))].join("/");
    p.think_time = `${ms}ms ±${jit}% on ${tt.length}/${reqs.length} requests`;
  }
  if (reqs.some((r) => r.extract)) p.response_chaining = true;
  return p;
}

/**
 * Render a latency value. Percentiles come from a 1ms-bucket histogram
 * (worker.js), so anything below 1ms is genuinely below the instrument's
 * resolution — "0 ms" would claim zero latency, which is never true.
 */
export const fmtMs = (v) => (v == null ? "—" : Number(v) < 1 ? "<1 ms" : `${v} ms`);
