/* A streaming target for Loadstar to test against.
 *
 * WHY: without this there is no way to PROVE that TTFT detection fires, and no way
 * to CI-guard it. A feature with no runnable proof is what distributed load
 * generation was: marked COMPLETE, never run, silently rotted for a week.
 *
 * Zero dependencies. Node stdlib only. */
import http from "node:http";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Env-tunable so a CI runner can shrink the timings without editing code. */
const TTFB_MS = Number(process.env.STREAM_TTFB_MS || 150);
const CHUNKS = Number(process.env.STREAM_CHUNKS || 12);
const CHUNK_GAP_MS = Number(process.env.STREAM_CHUNK_GAP_MS || 110);
const SLOW_MS = Number(process.env.SLOW_MS || 1500);

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];

  if (path === "/stream") {
    /* A HEALTHY streaming response: the first token arrives FAST, then generation
       takes a while. Total latency will be ~1.5s. The user FEELS ~150ms.

       THIS IS THE LIE Loadstar exists to expose: every other load tester reports
       the 1.5s and calls it "latency". */
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    await sleep(TTFB_MS);
    for (let i = 0; i < CHUNKS; i++) {
      res.write("data: token " + i + "\n\n");
      await sleep(CHUNK_GAP_MS);
    }
    res.end("data: [DONE]\n\n");
    return;
  }

  if (path === "/slow") {
    /* THE CONTROL. Slow, but it answers ALL AT ONCE. TTFB == total.

       Total latency is HONEST here — the user really does wait 1.5s staring at
       nothing. There is nothing to warn about.

       Without this control, a detector that simply fired on "anything slow" would
       look like it worked. This is what makes the test able to FAIL. */
    await sleep(SLOW_MS);
    const body = JSON.stringify({ ok: true, note: "slow but not streaming" });
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  if (path === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(80, () => {
  console.log("[stream-demo] listening on :80");
  console.log("  GET /stream  TTFB ~" + TTFB_MS + "ms, total ~" +
    (TTFB_MS + CHUNKS * CHUNK_GAP_MS) + "ms  -> Loadstar MUST warn");
  console.log("  GET /slow    TTFB ~" + SLOW_MS + "ms, total ~" + SLOW_MS +
    "ms      -> Loadstar MUST stay quiet (the control)");
});
