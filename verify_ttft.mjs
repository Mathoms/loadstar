// verify_ttft.mjs
//
// THE THESIS, IN ONE TABLE:
//
//   /stream   TTFB  150ms   total 1500ms   ratio 0.10   -> STREAMING (must warn)
//   /slow     TTFB 1500ms   total 1500ms   ratio 1.00   -> NOT streaming (must be quiet)
//
//   SAME TOTAL LATENCY. OPPOSITE VERDICT.
//
// A 1.5s response that starts arriving at 150ms feels INSTANT. A 1.5s response that
// starts at 1.5s feels SLOW. Every load tester on earth reports the same number for
// both and calls it "latency".
//
// /slow IS THE CONTROL, AND IT IS THE POINT. Without it, a detector that simply
// fired on "anything slow" would look like it worked. If /slow ALSO warns, the
// feature is worthless and we say so.
//
// Run from the repo root:   node verify_ttft.mjs

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
  process.stdout.write('   ' + tag + ' ');
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const cur = await api('GET', '/runs/' + run.id);
    if (['done', 'failed', 'cancelled'].includes(cur.status)) {
      console.log(' -> ' + cur.status);
      return cur;
    }
    process.stdout.write('.');
  }
  console.log(' -> TIMED OUT');
  return null;
}

const mk = (name, path, engine) => ({
  name,
  target_url: 'http://stream-demo' + path,
  engine,
  mode: 'load',
  virtual_users: 3,
  ramp_up_secs: 0,
  duration_secs: 20,
});

async function measure(engine, label, path) {
  const t = await api('POST', '/tests', mk('ttft ' + label + ' ' + engine, path, engine));
  const run = await runAndWait(t.id, label.padEnd(7));
  if (!run || run.status !== 'done') {
    ck(engine + ' ' + label + ': run completed', false, 'status=' + (run && run.status) + ' err=' + (run && run.error));
    return null;
  }
  const s = run.summary || {};
  const fb = s.first_byte;
  if (!fb) {
    ck(engine + ' ' + label + ': first_byte exists', false, 'MISSING — the parser is not reading TTFB');
    return null;
  }
  console.log('     ttfb p95 ' + String(fb.p95_ms).padStart(5) + 'ms' +
              '   total p95 ' + String(s.p95_ms).padStart(5) + 'ms' +
              '   ratio ' + String(fb.ttfb_to_total_ratio).padEnd(5) +
              '   streaming: ' + fb.streaming_detected);
  return { s, fb };
}

async function check(engine) {
  console.log('\n=================== ' + engine.toUpperCase() + ' ===================');

  /* ---- the streaming case: total latency IS LYING ---- */
  const st = await measure(engine, 'stream', '/stream');
  if (!st) return;

  ck(engine + ' /stream: TTFB is much FASTER than total',
    st.fb.p95_ms < st.s.p95_ms * 0.5,
    'ttfb=' + st.fb.p95_ms + ' total=' + st.s.p95_ms);
  ck(engine + ' /stream: *** STREAMING DETECTED ***',
    st.fb.streaming_detected === true,
    'The response starts arriving long before it finishes, and Loadstar did not notice.');
  ck(engine + ' /stream: it NAMES the misleading number',
    !!(st.fb.warning && st.fb.warning.includes('LAST token')),
    JSON.stringify(st.fb.warning));

  /* ---- THE CONTROL: slow, but honest ---- */
  const sl = await measure(engine, 'slow', '/slow');
  if (!sl) return;

  ck(engine + ' /slow: TTFB \u2248 total (it arrives all at once)',
    sl.fb.ttfb_to_total_ratio > 0.8,
    'ratio=' + sl.fb.ttfb_to_total_ratio);
  ck(engine + ' /slow: *** STAYS QUIET (the control) ***',
    sl.fb.streaming_detected === false,
    'THE DETECTOR IS JUST FIRING ON "SLOW". A tool that warns about every slow endpoint ' +
    'gets ignored within a week, and then it fails to protect anyone when it matters. ' +
    'The feature is worthless as it stands.');

  /* ---- the punchline ---- */
  const sameish = Math.abs(st.s.p95_ms - sl.s.p95_ms) < st.s.p95_ms * 0.5;
  ck(engine + ' the two runs have SIMILAR total latency but OPPOSITE verdicts',
    sameish && st.fb.streaming_detected !== sl.fb.streaming_detected,
    'stream total=' + st.s.p95_ms + ' slow total=' + sl.s.p95_ms);
}

console.log('TIME-TO-FIRST-TOKEN ACCEPTANCE TEST');
console.log('A 1.5s response that starts at 150ms feels INSTANT.');
console.log('A 1.5s response that starts at 1.5s feels SLOW.');
console.log('Same number. Opposite experience. Every other load tester reports only the first.');

try {
  await check('k6');
  await check('jmeter');
} catch (err) {
  console.log('\n\u2717 FATAL: ' + err.message);
  fail++;
}

console.log('\n===========================================');
console.log('PASS ' + pass + '   FAIL ' + fail);
console.log(fail === 0
  ? '\u2713 TTFT WORKS \u2014 it warns on streaming, and STAYS QUIET on merely slow.'
  : '\u2717 NOT WORKING. Do not ship this.');
console.log('===========================================');

process.exit(fail === 0 ? 0 : 1);
