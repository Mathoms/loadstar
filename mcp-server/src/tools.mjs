import { z } from 'zod';
import { loadstarRequest } from './client.mjs';

const EXPOSE_DEBUG_TRACE = process.env.LOADSTAR_EXPOSE_DEBUG_TRACE === 'true';
const TERMINAL = ['done', 'failed', 'cancelled'];

function ok(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

function fail(err) {
  return { content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true };
}

// Wrap every handler. A thrown error becomes an MCP tool error rather than a
// crashed stdio process — a crash takes the whole server down mid-session and
// the developer just sees the tools vanish.
function guard(fn) {
  return async (args) => {
    try {
      return await fn(args || {});
    } catch (err) {
      return fail(err);
    }
  };
}

/**
 * GET /runs/:id returns runs.* — which includes debug_trace (REAL
 * Authorization tokens, plaintext, per SECURITY.md) and timeseries (large).
 *
 * MCP is a NEW LAYER WITH AN OPINION about debug traces: everything a tool
 * returns lands in an LLM context window. So strip both by default. This is
 * the master-record corollary applied to a new layer.
 */
function sanitizeRun(run) {
  if (!run || typeof run !== 'object') return run;
  const out = { ...run };

  if (!EXPOSE_DEBUG_TRACE && out.debug_trace != null) {
    out.debug_trace =
      '[stripped: contains real auth tokens in plaintext. Set LOADSTAR_EXPOSE_DEBUG_TRACE=true to include.]';
  }

  if (Array.isArray(out.timeseries) && out.timeseries.length > 0) {
    out.timeseries_points = out.timeseries.length;
    out.timeseries =
      '[omitted: ' + out.timeseries.length + ' points. The metrics live in summary.]';
  }

  return out;
}

export function registerLoadstarTools(server) {
  /* ---------------- config ---------------- */
  server.registerTool(
    'loadstar_get_config',
    {
      title: 'Get Loadstar limits',
      description: "Effective server-side limits (GET /config): max_virtual_users, max_duration_secs, distribution_vu_threshold, max_shards, max_browser_users, max_browser_loops. This is the single source of truth — check it before creating a test rather than assuming caps.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => ok(await loadstarRequest('GET', '/config')))
  );

  /* ---------------- tests ---------------- */
  server.registerTool(
    'loadstar_list_tests',
    {
      title: 'List tests',
      description: "List test definitions (GET /tests). Hidden background-load companion tests are excluded. Max 100, newest first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => ok(await loadstarRequest('GET', '/tests')))
  );

  server.registerTool(
    'loadstar_create_test',
    {
      title: 'Create a test',
      description: "Create a load or browser test (POST /tests). Server-side validateTestInput has the final say — call loadstar_get_config first and stay inside the limits. For an HTTP test, use requests[] for multi-step sequences (per-request think time, assertions, and extract/chaining). For a browser test, set test_type=browser and supply browser_steps[].",
      inputSchema: {
        name: z.string(),
        target_url: z.string().describe("Target URL. Must pass the SSRF guard and the domain allow-list."),
        test_type: z.enum(['http', 'browser']).optional().describe("Default http."),
        engine: z.enum(['jmeter', 'k6']).optional().describe("HTTP tests only. Default jmeter. Browser tests always use playwright."),
        mode: z.enum(['load', 'stress', 'spike', 'soak']).optional().describe("Default load."),
        method: z.string().optional().describe("Default GET."),
        headers: z.record(z.string()).optional(),
        body: z.string().optional(),
        virtual_users: z.number().int().positive().optional().describe("Default 10 for http, 1 for browser. Capped by max_virtual_users."),
        ramp_up_secs: z.number().int().min(0).optional().describe("Default 30."),
        duration_secs: z.number().int().positive().optional().describe("Default 120. Capped by max_duration_secs."),
        loops: z.number().int().positive().optional().describe("Browser tests: iterations per user. Default 1."),
        browser: z.enum(['chromium', 'firefox', 'webkit']).optional().describe("Browser tests. Default chromium."),
        requests: z.array(z.record(z.any())).optional().describe("HTTP multi-request sequence. Each entry may carry think time, assertions, and extract (response chaining)."),
        browser_steps: z.array(z.record(z.any())).optional().describe("Browser steps: goto, click, fill, wait_for, pause — plus checks: expect_text, expect_no_text, expect_visible, expect_url."),
        background_load: z.record(z.any()).optional().describe("Browser-under-load: {virtual_users, duration_secs}. Creates a hidden companion HTTP load test that hammers the target while the browser flow is measured."),
        sla: z.record(z.any()).optional().describe("Thresholds. A failed SLA sets a flag a CI pipeline can gate on."),
        csv_data: z.string().optional().describe("CSV content for column parameterization."),
        notify_email: z.string().optional(),
        distribution_mode: z.enum(['auto', 'on', 'off']).optional().describe("Distributed load generation. Default auto."),
        shard_count_override: z.number().int().min(2).optional().describe("Force a generator count. Requires docker compose up --scale worker=N."),
      },
    },
    guard(async (args) => ok(await loadstarRequest('POST', '/tests', args)))
  );

  server.registerTool(
    'loadstar_delete_test',
    {
      title: 'Delete a test',
      description: "Delete a test (DELETE /tests/:id). Cascades to its runs and schedules, and removes any hidden companion test. Not reversible.",
      inputSchema: { test_id: z.string() },
      annotations: { destructiveHint: true },
    },
    guard(async ({ test_id }) => ok(await loadstarRequest('DELETE', '/tests/' + test_id)))
  );

  /* ---------------- runs ---------------- */
  server.registerTool(
    'loadstar_run_test',
    {
      title: 'Start a run',
      description: "Queue a run for an existing test (POST /tests/:id/runs). Returns immediately (HTTP 202) with a QUEUED run — the run is NOT finished and carries no results yet. Poll with loadstar_get_run, or use loadstar_wait_for_run.",
      inputSchema: {
        test_id: z.string(),
        debug: z.boolean().optional().describe("Capture a debug trace. WARNING: stores real Authorization tokens in plaintext in the database. Non-production credentials only."),
        compare_to: z.string().optional().describe("Pin this run’s comparison to a specific completed run of the same test (CI: PR build vs main build). Does not touch the baseline."),
      },
    },
    guard(async ({ test_id, debug, compare_to }) => {
      const body = {};
      if (debug !== undefined) body.debug = debug;
      if (compare_to !== undefined) body.compare_to = compare_to;
      const run = await loadstarRequest('POST', '/tests/' + test_id + '/runs', body);
      return ok({
        ...sanitizeRun(run),
        _note:
          'This run is QUEUED, not finished. Call loadstar_wait_for_run to await results.',
      });
    })
  );

  server.registerTool(
    'loadstar_list_runs',
    {
      title: 'List runs',
      description: "List recent runs (GET /runs) — newest first, shard rows excluded. IMPORTANT: the API returns the 100 most recent runs ACROSS ALL TESTS. The test_id argument filters that page client-side, so an empty result does NOT prove a test has never run — it may simply have no runs among the recent 100.",
      inputSchema: {
        test_id: z.string().optional().describe("Filter the returned page to one test (client-side — see the note above)."),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ test_id }) => {
      const runs = await loadstarRequest('GET', '/runs');
      if (!test_id || !Array.isArray(runs)) return ok(runs);
      const filtered = runs.filter((x) => x.test_id === test_id);
      return ok({
        runs: filtered,
        _note:
          'Filtered client-side from the 100 most recent runs across ALL tests. ' +
          'An empty result does not prove this test has never run.',
      });
    })
  );

  server.registerTool(
    'loadstar_get_run',
    {
      title: 'Get a run',
      description: "Full status and results for one run (GET /runs/:id). Read metrics from summary. The real keys are: total_requests (NOT requests), error_rate and errors (NOT error_rate_pct), throughput_rps, wall_seconds, avg_ms / min_ms / max_ms / p50_ms / p90_ms / p95_ms / p99_ms, assertion_total and assertion_failures, and generator (cores, saturated, avg_load_ratio, peak_load_ratio). summary.per_endpoint is a PER-ENDPOINT breakdown (one row per request label: requests, errors, error_rate, avg/p50/p90/p95/p99, assertion counts), sorted slowest-p95 first. THE REAL ANSWER IS USUALLY HERE: a blended p95 can look healthy while ONE endpoint is catastrophically slow, and a 33% error rate usually means one broken route rather than a system-wide capacity problem. Read per_endpoint before concluding anything from the aggregate, and name the guilty endpoint. The error keys are errors and error_rate — there is no error_rate_pct. Assertion failures are counted SEPARATELY from network errors: assertion_failures means up-but-wrong, errors means server-failing. summary.generator reports the load generator CONTAINER own CPU usage during the run (avg_load_ratio / peak_load_ratio, 0..1). saturated fires only on SUSTAINED load (avg >= 0.85, or 2+ consecutive samples >= 0.90) - a brief startup spike is not saturation. If saturated is true, the load generator itself was CPU-starved, so the latency and throughput numbers are unreliable and the target is not to blame. If saturated is false, the generator was not the bottleneck and the numbers can be read at face value. Statuses: queued, running, coordinating, done, failed, cancelled. A cancelled run is NOT a pass.",
      inputSchema: { run_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ run_id }) =>
      ok(sanitizeRun(await loadstarRequest('GET', '/runs/' + run_id)))
    )
  );

  server.registerTool(
    'loadstar_wait_for_run',
    {
      title: 'Wait for a run to finish',
      description: "Poll a run until it reaches a terminal status (done, failed, or cancelled) or the timeout elapses. The natural companion to loadstar_run_test. Timing out is NOT a run failure — the run keeps going; only the wait gave up.",
      inputSchema: {
        run_id: z.string(),
        timeout_secs: z.number().int().min(5).max(3900).optional().describe("Default 300. Set this above the test duration_secs, plus ramp-up and queue time."),
        poll_secs: z.number().int().min(1).max(60).optional().describe("Default 5."),
      },
    },
    guard(async ({ run_id, timeout_secs, poll_secs }) => {
      const timeout = (timeout_secs ?? 300) * 1000;
      const interval = (poll_secs ?? 5) * 1000;
      const started = Date.now();
      let last = null;

      while (Date.now() - started < timeout) {
        last = await loadstarRequest('GET', '/runs/' + run_id);
        if (last && TERMINAL.includes(last.status)) return ok(sanitizeRun(last));
        await new Promise((res) => setTimeout(res, interval));
      }

      return ok({
        _timed_out: true,
        _note:
          'The wait timed out after ' +
          timeout / 1000 +
          's. The run is STILL GOING (status: ' +
          ((last && last.status) || 'unknown') +
          '). This is NOT a test failure. Wait again with a longer timeout_secs, or stop it with loadstar_stop_run.',
        run: sanitizeRun(last),
      });
    })
  );

  server.registerTool(
    'loadstar_stop_run',
    {
      title: 'Stop a run',
      description: "Stop a queued, running, or coordinating run (POST /runs/:id/cancel). A queued run is cancelled outright. A running run gets SIGTERM and KEEPS its partial results. For a distributed run, every shard is stopped too. A cancelled run is NOT a pass, and is excluded from history and baselines.",
      inputSchema: { run_id: z.string() },
      annotations: { destructiveHint: true },
    },
    guard(async ({ run_id }) =>
      ok(await loadstarRequest('POST', '/runs/' + run_id + '/cancel', {}))
    )
  );

  /* ------------ analysis & baseline (the AI wedge) ------------ */
  server.registerTool(
    'loadstar_analyze_run',
    {
      title: 'Run AI analysis on a run',
      description: "Run (or re-run) Claude analysis on a COMPLETED run (POST /runs/:id/analyze) and store it against the run. Returns verdict, trend, headline, pros, cons, findings, and recommendations. Requires status=done — a still-running run returns HTTP 409.",
      inputSchema: { run_id: z.string() },
    },
    guard(async ({ run_id }) =>
      ok(await loadstarRequest('POST', '/runs/' + run_id + '/analyze', {}))
    )
  );

  server.registerTool(
    'loadstar_set_baseline',
    {
      title: 'Mark a run as the baseline',
      description: "Mark a COMPLETED run as this test’s known-good baseline (POST /runs/:id/baseline). One baseline per test — setting a new one clears the old. The baseline stays in history permanently, so a string of bad runs can never read as stable. IMPORTANT: this REFUSES a run whose generator was saturated (HTTP 400, reason generator_saturated), because such a run has numbers that describe the load generator rather than the target, and every future run is compared against the baseline. Do not reflexively retry with force. Prefer to fix the run: fewer virtual_users, add think time, or more generators. Only pass force: true if the user explicitly accepts an unreliable baseline - it is recorded as a forced baseline and returns a warning.",
      inputSchema: { run_id: z.string() },
    },
    guard(async ({ run_id }) =>
      ok(await loadstarRequest('POST', '/runs/' + run_id + '/baseline', {}))
    )
  );

  server.registerTool(
    'loadstar_clear_baseline',
    {
      title: 'Clear the baseline',
      description: "Clear the baseline for the test that owns this run (DELETE /runs/:id/baseline).",
      inputSchema: { run_id: z.string() },
    },
    guard(async ({ run_id }) =>
      ok(await loadstarRequest('DELETE', '/runs/' + run_id + '/baseline'))
    )
  );

  /* ---------------- report ---------------- */
  server.registerTool(
    'loadstar_get_report',
    {
      title: 'Get the HTML report',
      description: "Fetch the full HTML report for a finished run (GET /runs/:id/export/html). Only works once status is done or cancelled. PDF and PPTX are async binary exports and are not exposed here — use the Loadstar UI for those. Returns raw HTML, which is long: prefer loadstar_get_run for metrics, and use this when the report document itself is wanted.",
      inputSchema: { run_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ run_id }) =>
      ok(
        await loadstarRequest('GET', '/runs/' + run_id + '/export/html', undefined, {
          raw: true,
        })
      )
    )
  );
}
