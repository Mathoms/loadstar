// verify_per_endpoint.mjs
//
// The acceptance test for per-endpoint breakdown. It MUST be able to fail.
//
// A single-endpoint test would produce a one-row table and prove nothing. So this
// builds a multi-request test where the endpoints GENUINELY DIFFER:
//
//     GET /            -> 200, fast
//     GET /index.html  -> 200, fast
//     GET /nope        -> 404, ERRORS
//
// The blended aggregate will look "mostly fine" — roughly a third of requests
// failing, spread across a healthy-looking average. THAT is the disease. The
// per-endpoint table has to point straight at /nope.
//
// If the table cannot separate them, the feature is worthless and we say so.
//
// Runs BOTH engines: k6 (reads tags.name) and JMeter (reads the JTL label column
// through the new quoted-CSV parser). They are different code paths and either
// could be wrong on its own.
//
// Run from the repo root:   node verify_per_endpoint.mjs

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

async function runAndWait(testId, label) {
  const run = await api('POST', '/tests/' + testId + '/runs', {});
  process.stdout.write('   ' + label + ': queued ' + run.id.slice(0, 8) + ' ');
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

function buildTest(engine) {
  return {
    name: 'per-endpoint proof (' + engine + ')',
    target_url: 'http://demo',
    engine,
    mode: 'load',
    virtual_users: 5,
    ramp_up_secs: 0,
    duration_secs: 15,
    requests: [
      { name: 'GET /', method: 'GET', path: '/' },
      { name: 'GET /index.html', method: 'GET', path: '/index.html' },
      // This one 404s. It MUST show up as the erroring endpoint, and ONLY it.
      { name: 'GET /nope', method: 'GET', path: '/nope' },
    ],
  };
}

function show(rows) {
  console.log('');
  console.log('   endpoint          reqs   errors   err%     p95');
  console.log('   ---------------------------------------------------');
  for (const r of rows) {
    console.log(
      '   ' + String(r.name).padEnd(17) +
      String(r.requests).padStart(5) +
      String(r.errors).padStart(9) +
      String(r.error_rate).padStart(7) +
      String(r.p95_ms + 'ms').padStart(8)
    );
  }
  console.log('');
}

async function checkEngine(engine) {
  console.log('\n=================== ' + engine.toUpperCase() + ' ===================');

  const test = await api('POST', '/tests', buildTest(engine));
  const run = await runAndWait(test.id, engine);

  if (!run || run.status !== 'done') {
    ck(engine + ': run completed', false, 'status=' + (run && run.status) + ' err=' + (run && run.error));
    return;
  }

  const s = run.summary || {};
  const rows = s.per_endpoint;

  ck(engine + ': summary.per_endpoint exists', Array.isArray(rows), 'got ' + typeof rows);
  if (!Array.isArray(rows)) return;

  show(rows);

  // --- THE POINT: it must SEPARATE, not blend ---
  ck(engine + ': THREE endpoints, not one blended row', rows.length === 3, 'got ' + rows.length + ' rows');

  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  const nope = byName['GET /nope'];
  const root = byName['GET /'];
  const index = byName['GET /index.html'];

  ck(engine + ': labels survived intact', !!nope && !!root && !!index,
    'names: ' + rows.map((r) => r.name).join(' | '));
  if (!nope || !root || !index) return;

  ck(engine + ': /nope is flagged as the errorer', nope.errors > 0,
    '/nope errors=' + nope.errors);
  ck(engine + ': the healthy endpoints are CLEAN', root.errors === 0 && index.errors === 0,
    '/ errors=' + root.errors + '  /index.html errors=' + index.errors);

  // A table that says every endpoint is equally bad is as useless as no table.
  ck(engine + ': it DISCRIMINATES (errors are not spread evenly)',
    nope.error_rate > root.error_rate && nope.error_rate > index.error_rate,
    'nope=' + nope.error_rate + '%  root=' + root.error_rate + '%  index=' + index.error_rate + '%');

  // Every endpoint should carry real request counts and percentiles.
  ck(engine + ': every endpoint has requests', rows.every((r) => r.requests > 0));
  ck(engine + ': every endpoint has percentiles', rows.every((r) => typeof r.p95_ms === 'number'));

  // Sanity: per-endpoint requests must sum to the total. If they do not, the
  // parser is dropping rows -- which would be a silently incomplete table.
  const sum = rows.reduce((a, r) => a + r.requests, 0);
  ck(engine + ': per-endpoint requests sum to total_requests',
    sum === s.total_requests,
    'sum=' + sum + '  total=' + s.total_requests);

  // And the blended view genuinely DID hide it -- which is the whole argument.
  console.log('   blended: ' + s.total_requests + ' reqs, ' + s.error_rate + '% errors, p95 ' + s.p95_ms + 'ms');
  console.log('   ^ the blend says "some errors somewhere". The table says WHICH.');
}

console.log('PER-ENDPOINT ACCEPTANCE TEST');
console.log('A table that blends is the old lie with more rows. It must SEPARATE.');

try {
  await checkEngine('k6');
  await checkEngine('jmeter');
} catch (err) {
  console.log('\n\u2717 FATAL: ' + err.message);
  fail++;
}

console.log('\n===========================================');
console.log('PASS ' + pass + '   FAIL ' + fail);
console.log(fail === 0
  ? '\u2713 PER-ENDPOINT WORKS \u2014 the slow/broken endpoint can no longer hide.'
  : '\u2717 NOT WORKING. Do not ship this.');
console.log('===========================================');

process.exit(fail === 0 ? 0 : 1);
