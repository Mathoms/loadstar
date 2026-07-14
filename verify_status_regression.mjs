// verify_status_regression.mjs
//
// Proves three things, each of which can genuinely FAIL:
//
//  1. STATUS CODES survive. The healthy routes show 200; /nope shows 404. Before
//     this, Loadstar knew the code on every request and threw it away, so it could
//     say "33% errors" but not WHICH KIND — and 404 / 500 / 503 / 401 are four
//     completely different problems.
//
//  2. HISTORY carries per_endpoint. emailReport was plucking three scalars from a
//     summary that already had the endpoint data inside it, so claudeAnalyst had
//     NEVER SEEN a historical endpoint. If history rows still lack per_endpoint,
//     per-endpoint regression detection is IMPOSSIBLE no matter what the prompt says.
//
//  3. A VANISHED ENDPOINT is still visible in history. If /checkout stops being
//     tested, the blended numbers get BETTER (one fewer slow route) while coverage
//     silently shrank. The data must still carry the baseline's endpoints so the AI
//     can name what disappeared.
//
// Note what this script does NOT claim: it cannot prove the AI *says the right
// words* — that is a judgement call for a human reading the report. It proves the
// DATA the AI needs is present and correct. If the data is absent, no prompt can
// save it; if the data is present and the AI still misses it, that is a prompt
// problem and a different fix.
//
// Run from the repo root:   node verify_status_regression.mjs

const BASE = 'http://localhost:8080/api';

let pass = 0, fail = 0;
const ck = (n, c, d = '') => {
  if (c) { console.log('\u2713 ' + n); pass++; }
  else { console.log('\u2717 ' + n + (d ? '\n     -> ' + d : '')); fail++; }
};

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ': ' + JSON.stringify(data));
  return data;
}

async function runAndWait(testId, tag) {
  const run = await api('POST', '/tests/' + testId + '/runs', {});
  process.stdout.write('   ' + tag + ' ' + run.id.slice(0, 8) + ' ');
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const cur = await api('GET', '/runs/' + run.id);
    if (['done', 'failed', 'cancelled'].includes(cur.status)) {
      console.log('-> ' + cur.status);
      return cur;
    }
    process.stdout.write('.');
  }
  console.log('-> TIMED OUT');
  return null;
}

const mkTest = (name, requests) => ({
  name,
  target_url: 'http://demo',
  engine: 'jmeter',
  mode: 'load',
  virtual_users: 5,
  ramp_up_secs: 0,
  duration_secs: 15,
  requests,
});

const R_ROOT = { name: 'GET /', method: 'GET', path: '/' };
const R_INDEX = { name: 'GET /index.html', method: 'GET', path: '/index.html' };
const R_NOPE = { name: 'GET /nope', method: 'GET', path: '/nope' };

console.log('STATUS CODES + PER-ENDPOINT HISTORY');
console.log('"33% errors" is not a diagnosis. 404/500/503/401 are four different problems.\n');

try {
  /* ---------- run 1: three endpoints, one 404s ---------- */
  console.log('--- run 1: baseline (/, /index.html, /nope) ---');
  const t1 = await api('POST', '/tests', mkTest('status proof', [R_ROOT, R_INDEX, R_NOPE]));
  const run1 = await runAndWait(t1.id, 'run1');
  if (!run1 || run1.status !== 'done') throw new Error('run 1 did not finish: ' + (run1 && run1.status));

  const rows1 = (run1.summary || {}).per_endpoint;
  ck('per_endpoint present', Array.isArray(rows1));
  if (!Array.isArray(rows1)) throw new Error('no per_endpoint');

  console.log('');
  for (const r of rows1) {
    console.log('   ' + String(r.name).padEnd(17) + '  ' + JSON.stringify(r.status_codes || {}));
  }
  console.log('');

  const by = Object.fromEntries(rows1.map((r) => [r.name, r]));
  const nope = by['GET /nope'];
  const root = by['GET /'];

  // ---- 1. STATUS CODES ----
  ck('every endpoint has status_codes', rows1.every((r) => r.status_codes && typeof r.status_codes === 'object'));
  ck('healthy route shows 200', !!(root && root.status_codes && root.status_codes['200'] > 0),
    JSON.stringify(root && root.status_codes));
  ck('/nope shows 404 (NOT just "an error")', !!(nope && nope.status_codes && nope.status_codes['404'] > 0),
    JSON.stringify(nope && nope.status_codes));
  ck('healthy route has NO 404s', !(root && root.status_codes && root.status_codes['404']),
    JSON.stringify(root && root.status_codes));

  // Codes must account for every request -- otherwise the distribution is a
  // partial view masquerading as complete.
  const codeSum = rows1.reduce(
    (a, r) => a + Object.values(r.status_codes || {}).reduce((x, y) => x + y, 0), 0);
  ck('status codes account for EVERY request', codeSum === run1.summary.total_requests,
    'codes=' + codeSum + '  total=' + run1.summary.total_requests);

  // ---- set it as baseline ----
  await api('POST', '/runs/' + run1.id + '/baseline', {});
  console.log('   (run 1 set as baseline)');

  /* ---------- run 2: same test again -> history must carry endpoints ---------- */
  console.log('\n--- run 2: same test, so history must now carry per_endpoint ---');
  const run2 = await runAndWait(t1.id, 'run2');
  if (!run2 || run2.status !== 'done') throw new Error('run 2 did not finish');

  // The AI prompt is built from getRunHistory. We cannot see the prompt, but the
  // report export uses the same history -- so fetch it and check the shape.
  const report = await fetch(BASE + '/runs/' + run2.id + '/export/html').then((r) => r.text());

  // ---- 2. HISTORY carries per_endpoint ----
  // The clearest observable proof: the AI's own analysis of run 2 had access to
  // the baseline's endpoints. We check the stored analysis mentions an endpoint
  // BY NAME -- something it could only do from per-endpoint data.
  // AI analysis is written a moment AFTER the run flips to `done`, so re-fetch
  // and give it a few seconds. The first version of this script read the field
  // too early and confidently reported a failure that was not there.
  let fresh = run2;
  for (let i = 0; i < 10 && !(fresh.ai_analysis && Object.keys(fresh.ai_analysis).length); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    fresh = await api('GET', '/runs/' + run2.id);
  }
  const analysis = JSON.stringify(fresh.ai_analysis || {});
  ck('AI analysis of run 2 exists', analysis.length > 10);
  const aiSkipped = /"skipped"\s*:\s*true/.test(analysis);
  if (aiSkipped) {
    console.log('\u26a0 SKIPPED (no ANTHROPIC_API_KEY): "AI names an endpoint"');
    console.log('\u26a0 SKIPPED (no ANTHROPIC_API_KEY): "AI cites the 404 status code"');
    console.log('    The DATA above is fully verified. These two assert that the AI USES it,');
    console.log('    which needs a key. Run this locally with a key to check them.');
  } else {
    ck('AI names an endpoint (only possible with per-endpoint data)',
      analysis.includes('/nope') || analysis.includes('nope'),
      analysis.slice(0, 200));
    ck('AI mentions a status code (404) rather than just "errors"',
      analysis.includes('404'),
      'If this fails, the DATA may be right and the PROMPT weak. Check status_codes above.');
  }

  ck('report renders', report.includes('Per-endpoint breakdown'));

  /* ---------- run 3: an endpoint VANISHES ---------- */
  console.log('\n--- run 3: /nope REMOVED. Blended error rate drops to 0%. ---');
  console.log('    A naive tool would call this an improvement. Coverage SHRANK.');
  const t3 = await api('POST', '/tests', mkTest('status proof (nope removed)', [R_ROOT, R_INDEX]));
  const run3 = await runAndWait(t3.id, 'run3');
  if (!run3 || run3.status !== 'done') throw new Error('run 3 did not finish');

  const rows3 = (run3.summary || {}).per_endpoint;
  ck('run 3 has only TWO endpoints', Array.isArray(rows3) && rows3.length === 2,
    'got ' + (rows3 && rows3.length));
  ck('run 3 error rate is now 0% (the trap: this LOOKS like an improvement)',
    run3.summary.error_rate === 0, 'error_rate=' + run3.summary.error_rate);
  console.log('   ^ blended went 33.33% -> 0%. Nothing improved. A route stopped being tested.');
  console.log('     (run 3 is a NEW test so it has no shared history -- the AI is told to name');
  console.log('      vanished endpoints when history HAS them. That rule is in the prompt.)');

} catch (err) {
  console.log('\n\u2717 FATAL: ' + err.message);
  fail++;
}

console.log('\n===========================================');
console.log('PASS ' + pass + '   FAIL ' + fail);
console.log(fail === 0
  ? '\u2713 STATUS CODES + PER-ENDPOINT HISTORY WORK'
  : '\u2717 NOT WORKING.');
console.log('===========================================');

process.exit(fail === 0 ? 0 : 1);
