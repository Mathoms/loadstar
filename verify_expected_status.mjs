// verify_expected_status.mjs
//
// Proves three things on BOTH engines. The third matters most.
//
//   A) assert.status 404 + got 404 -> 0 errors, assertion PASSES     (the fix)
//   B) assert.status 200 + got 404 -> assertion FAILS, not an error  (still caught)
//   C) NO assert         + got 404 -> STILL AN ERROR                 (not weakened)
//
// (C) IS THE ONE THAT MATTERS. If this fix makes real 404s stop counting as errors,
// we have not fixed a lie — WE HAVE REPLACED IT WITH A BIGGER ONE. A load tester
// that under-reports errors is worse than one that over-reports them: the first
// hides outages, the second only annoys you.
//
// (B) matters nearly as much: an assertion that can no longer FAIL is not an
// assertion. If assume_success / expectedStatuses were applied too broadly, a
// wrong status would sail through as a pass — and we would have built a tool that
// cannot detect a broken endpoint.
//
// Run from the repo root:   node verify_expected_status.mjs

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
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
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

const mk = (name, engine, requests) => ({
  name, target_url: 'http://demo', engine,
  mode: 'load', virtual_users: 3, ramp_up_secs: 0, duration_secs: 10,
  requests,
});

async function check(engine) {
  console.log('\n================= ' + engine.toUpperCase() + ' =================');

  /* ---- A) an EXPECTED 404 must not be an error ---- */
  const tA = await api('POST', '/tests', mk('exp-status A ' + engine, engine, [
    { name: 'GET /nope (expect 404)', method: 'GET', path: '/nope', assert: { status: 404 } },
  ]));
  const rA = await runAndWait(tA.id, 'A: expect 404, get 404');
  if (!rA || rA.status !== 'done') { ck(engine + ' A: run completed', false, String(rA && rA.status)); return; }

  const sA = rA.summary || {};
  console.log('     errors=' + sA.errors + '  error_rate=' + sA.error_rate +
              '  assertions=' + sA.assertion_failures + '/' + sA.assertion_total);

  ck(engine + ' A: an EXPECTED 404 is NOT an error', (sA.errors || 0) === 0,
     'errors=' + sA.errors + ' — a deliberate 404 test still inflates error_rate, which feeds the SLA gate');
  ck(engine + ' A: error_rate is 0%', (sA.error_rate || 0) === 0, 'error_rate=' + sA.error_rate);
  ck(engine + ' A: the assertion PASSED (it was checked, not ignored)',
     (sA.assertion_total || 0) > 0 && (sA.assertion_failures || 0) === 0,
     'total=' + sA.assertion_total + ' failures=' + sA.assertion_failures);
  ck(engine + ' A: the 404 is still VISIBLE in status_codes',
     JSON.stringify(sA.per_endpoint || []).includes('"404"'),
     'the fix must not HIDE the status — only stop miscounting it');

  /* ---- B) a WRONG status must still fail ---- */
  const tB = await api('POST', '/tests', mk('exp-status B ' + engine, engine, [
    { name: 'GET /nope (expect 200)', method: 'GET', path: '/nope', assert: { status: 200 } },
  ]));
  const rB = await runAndWait(tB.id, 'B: expect 200, get 404');
  if (!rB || rB.status !== 'done') { ck(engine + ' B: run completed', false, String(rB && rB.status)); return; }

  const sB = rB.summary || {};
  console.log('     errors=' + sB.errors + '  assertions=' + sB.assertion_failures + '/' + sB.assertion_total);

  ck(engine + ' B: a WRONG status still FAILS the assertion',
     (sB.assertion_failures || 0) > 0,
     'An assertion that cannot fail is not an assertion. If this passes, the fix was applied too broadly and a broken endpoint would sail through.');

  /* ---- C) THE ONE THAT MATTERS: an UNEXPECTED 404 is still an error ---- */
  const tC = await api('POST', '/tests', mk('exp-status C ' + engine, engine, [
    { name: 'GET /nope (no assert)', method: 'GET', path: '/nope' },
  ]));
  const rC = await runAndWait(tC.id, 'C: no assert, get 404');
  if (!rC || rC.status !== 'done') { ck(engine + ' C: run completed', false, String(rC && rC.status)); return; }

  const sC = rC.summary || {};
  console.log('     errors=' + sC.errors + '  error_rate=' + sC.error_rate);

  ck(engine + ' C: *** an UNASSERTED 404 is STILL AN ERROR ***',
     (sC.errors || 0) > 0,
     'CRITICAL: real 404s have stopped counting as errors. This is WORSE than the bug we set out to fix — a load tester that under-reports errors HIDES OUTAGES.');
  ck(engine + ' C: error_rate is 100%', (sC.error_rate || 0) > 99, 'error_rate=' + sC.error_rate);
}

console.log('EXPECTED-STATUS ACCEPTANCE TEST');
console.log('A deliberate 404 must not inflate error_rate — WITHOUT weakening real error detection.');

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
  ? '\u2713 EXPECTED STATUS WORKS \u2014 and real errors are still caught.'
  : '\u2717 NOT WORKING. Do not ship this.');
console.log('===========================================');

process.exit(fail === 0 ? 0 : 1);
