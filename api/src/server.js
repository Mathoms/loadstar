import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, pool, audit } from "./db.js";
import { headers, limiter, apiKeyAuth, authLimiter, warnOnWeakApiKey } from "./middleware/security.js";
import { isTargetAllowed } from "./services/targetVerification.js";
import api from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind Codespaces/reverse proxies, X-Forwarded-For is set by the proxy;
// trust exactly one hop so express-rate-limit identifies clients correctly.
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(headers);
app.use(limiter);
app.use(express.json({ limit: "256kb" }));

// Web UI (static, no build step for the MVP)
app.use(express.static(path.join(__dirname, "..", "..", "web")));

// API
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "loadstar-api" }));
warnOnWeakApiKey();

// authLimiter runs BEFORE apiKeyAuth — a brute-force guard that fires only on
// 401s. It has to precede the key check, or an attacker guesses straight past it.
app.use("/api", authLimiter, apiKeyAuth, api);

// Central error handler — never leak stack traces to clients.
app.use((err, _req, res, _next) => {
  console.error("[api]", err);
  res.status(500).json({ error: "Internal error" });
});

// Last-resort safety net: log instead of dying on anything that slips through.
process.on("unhandledRejection", (err) => console.error("[api] unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("[api] uncaught exception:", err));

const port = Number(process.env.PORT || 8080);

/** Cron-lite scheduler: every minute, queue runs for schedules that are due. */
async function runScheduler() {
  try {
    const due = await pool.query(`
      SELECT s.id, s.test_id, s.interval_minutes, t.target_url, t.companion_test_id, t.name
      FROM schedules s JOIN tests t ON t.id = s.test_id
      WHERE s.enabled
        AND (s.last_run_at IS NULL OR s.last_run_at + (s.interval_minutes || ' minutes')::interval <= now())`);
    for (const s of due.rows) {
      const gate = await isTargetAllowed(s.target_url);
      if (!gate.allowed) {
        console.warn(`[scheduler] skipping "${s.name}": ${gate.reason}`);
        await pool.query("UPDATE schedules SET last_run_at=now() WHERE id=$1", [s.id]);
        continue;
      }
      let companionRunId = null;
      if (s.companion_test_id) {
        const c = await pool.query("INSERT INTO runs (test_id) VALUES ($1) RETURNING id", [s.companion_test_id]);
        companionRunId = c.rows[0].id;
      }
      await pool.query("INSERT INTO runs (test_id, companion_run_id) VALUES ($1,$2)", [s.test_id, companionRunId]);
      await pool.query("UPDATE schedules SET last_run_at=now() WHERE id=$1", [s.id]);
      await audit("scheduler", "run.queued", s.test_id, { schedule_id: s.id });
      console.log(`[scheduler] queued "${s.name}" (every ${s.interval_minutes}m)`);
    }
  } catch (e) {
    console.error("[scheduler] error:", e.message);
  }
}

migrate()
  .then(() => {
    app.listen(port, () => console.log(`[api] Loadstar listening on :${port}`));
    setInterval(runScheduler, 60_000);
  })
  .catch((e) => {
    console.error("[api] migration failed:", e);
    process.exit(1);
  });
