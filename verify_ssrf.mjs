// verify_ssrf.mjs — self-contained. Tests the SSRF resolver logic against real DNS,
// with no dependency on the DB or the running app.
//
// An SSRF fix has TWO failure modes:
//   1. lets a dangerous target through  -> vuln not fixed
//   2. blocks a legitimate target       -> every real test breaks (outage w/ good intentions)
//
// Run from the repo root:  node verify_ssrf.mjs
import dns from 'node:dns/promises';

// Import the REAL predicate instead of re-implementing it. A test with its own
// copy of the logic is not a test — it is a second thing to keep in sync, and
// an inlined copy here is exactly what let the [::1] bracket-stripping fix
// land in the app while this script kept testing a stale version of itself.
// lib/ssrfGuard.js is dependency-free (only node:net) so this import needs no
// npm install and no DB — this script still runs standalone, as designed.
import { isPrivateAddress } from './api/src/lib/ssrfGuard.js';

function net_isIP(s){ return /^\d+\.\d+\.\d+\.\d+$/.test(s) || s.includes(":"); }
async function resolveAll(host){
  if (net_isIP(host)) return [host];
  const a=[]; try{for(const x of await dns.resolve4(host))a.push(x);}catch{}
  try{for(const x of await dns.resolve6(host))a.push(x);}catch{}
  return a.length?a:null;
}
async function targetResolvesToPrivate(url){
  let host; try{host=new URL(url).hostname;}catch{return{blocked:true,reason:"unparseable"};}
  const addrs=await resolveAll(host);
  if(!addrs) return {blocked:true,reason:`could not resolve ${host}`};
  for(const ip of addrs) if(isPrivateAddress(ip)) return {blocked:true,reason:`${host} -> ${ip} (internal)`,resolved:addrs};
  return {blocked:false,resolved:addrs};
}

let pass=0,fail=0;
const ck=(n,c,d='')=>{c?(console.log('\u2713 '+n),pass++):(console.log('\u2717 '+n+(d?'  -> '+d:'')),fail++);};

console.log('SSRF RESOLVE-GATE TEST\n');

// A. must BLOCK — literals
for (const [url,why] of [
  ['http://169.254.169.254/','cloud metadata'],
  ['http://10.0.0.5/','RFC1918'],
  ['http://127.0.0.1/','loopback'],
  ['http://[::1]/','IPv6 loopback'],
  ['http://192.168.1.1/','RFC1918'],
]) {
  const r=await targetResolvesToPrivate(url);
  ck('BLOCK '+url+' ('+why+')', r.blocked===true, JSON.stringify(r));
}

// A2. must BLOCK — a public NAME that resolves to loopback (the real attack shape)
try {
  const r=await targetResolvesToPrivate('http://localtest.me/');
  ck('BLOCK localtest.me (public name -> 127.0.0.1: the actual attack)', r.blocked===true, JSON.stringify(r));
} catch(e){ console.log('  (localtest.me unreachable in sandbox: '+e.message+')'); }

// B. must NOT block a genuinely public host
try {
  const r=await targetResolvesToPrivate('http://example.com/');
  ck('ALLOW example.com (genuinely public)', r.blocked===false, JSON.stringify(r));
} catch(e){ console.log('  (example.com unreachable in sandbox: '+e.message+')'); }

// B2. the fix must not touch single-label docker names (handled by ALLOW_PRIVATE_TARGETS upstream)
ck('demo is recognised as internal (isPrivateAddress)', isPrivateAddress('demo')===true);
ck('stream-demo is recognised as internal', isPrivateAddress('stream-demo')===true);

console.log('\nPASS '+pass+'  FAIL '+fail);
console.log(fail===0?'\u2713 SSRF GATE WORKS':'\u2717 NOT WORKING');
process.exit(fail?1:0);
