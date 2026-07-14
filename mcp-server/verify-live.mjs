// Live end-to-end proof: drive a REAL Loadstar run through the MCP server.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = new StdioClientTransport({
  command: 'node',
  args: [path.join(here, 'src/index.mjs')],
  env: {
    PATH: process.env.PATH,
    LOADSTAR_API_URL: 'http://localhost:8080',
    LOADSTAR_API_KEY: process.env.LOADSTAR_API_KEY || '',
  },
});
const c = new Client({ name: 'live-verify', version: '1.0.0' });
await c.connect(t);

const call = async (n, a = {}) => {
  const r = await c.callTool({ name: n, arguments: a });
  const txt = r.content[0].text;
  if (r.isError) throw new Error(n + ' FAILED: ' + txt);
  return txt;
};

console.log('\n[1] get_config');
console.log(await call('loadstar_get_config'));

console.log('\n[2] create_test');
const test = JSON.parse(
  await call('loadstar_create_test', {
    name: 'MCP live check',
    target_url: 'http://demo',
    engine: 'k6',
    virtual_users: 5,
    ramp_up_secs: 0,
    duration_secs: 15,
  })
);
console.log('test id:', test.id);

console.log('\n[3] run_test');
const run = JSON.parse(await call('loadstar_run_test', { test_id: test.id }));
console.log('run id:', run.id, '| status:', run.status);

console.log('\n[4] wait_for_run (up to 180s)');
const done = JSON.parse(
  await call('loadstar_wait_for_run', { run_id: run.id, timeout_secs: 180, poll_secs: 3 })
);
console.log('final status:', done.status);
console.log('summary:', JSON.stringify(done.summary, null, 2));

const s = done.summary || {};
const checks = [
  ['status is done', done.status === 'done'],
  ['total_requests > 0', Number(s.total_requests) > 0],
  ['error_rate present (not error_rate_pct)', s.error_rate !== undefined],
  ['no plaintext token in output', !JSON.stringify(done).includes('Bearer tok_')],
];

console.log('\n[5] get_report');
const html = await call('loadstar_get_report', { run_id: run.id });
checks.push(['report is real HTML', html.includes('<html') && html.length > 500]);
console.log('report length:', html.length, 'chars');

console.log('\n========== RESULT ==========');
let fail = 0;
for (const [name, okv] of checks) {
  console.log((okv ? '\u2713 ' : '\u2717 ') + name);
  if (!okv) fail++;
}
console.log(fail === 0 ? '\u2713 LIVE END-TO-END PASSED' : '\u2717 ' + fail + ' FAILED');
console.log('============================');
await c.close();
process.exit(fail === 0 ? 0 : 1);
