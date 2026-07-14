import { makeHistogram, mergeHistograms } from "../histogram.js";

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
  ok ? pass++ : fail++;
};

// Build a shard: n requests all at the same latency
const shard = (ms, n) => { const h = makeHistogram(); for (let i=0;i<n;i++) h.add(ms); return h.snapshot(); };

// Case 1: 100 @ 10ms  +  100 @ 20ms  → half and half
{
  const m = mergeHistograms([shard(10,100), shard(20,100)]);
  check("case1 count", m.count, 200);
  check("case1 avg",   m.avg_ms, 15);          // (10*100+20*100)/200
  check("case1 p50",   m.p50_ms, 10);          // 100th value sits in the 10ms bin
  check("case1 p99",   m.p99_ms, 20);
  check("case1 min",   m.min_ms, 10);
  check("case1 max",   m.max_ms, 20);
}

// Case 2: 300 @ 10ms  +  100 @ 20ms  → 75% are 10ms.
// The average-the-percentiles BUG would say p50 = (10+20)/2 = 15. Correct = 10.
{
  const m = mergeHistograms([shard(10,300), shard(20,100)]);
  check("case2 count", m.count, 400);
  check("case2 p50 (bug-catcher)", m.p50_ms, 10);   // NOT 15
  check("case2 p90", m.p90_ms, 20);                 // 90th pct is past the 75% mark
  check("case2 avg", m.avg_ms, 13);                 // (3000+2000)/400 = 12.5 → 13
}

// Case 3: single shard in, must equal itself (merge of one = identity)
{
  const single = shard(42, 50);
  const m = mergeHistograms([single]);
  check("case3 p50 identity", m.p50_ms, 42);
  check("case3 count", m.count, 50);
}

// Case 4: empty / all-zero shards must not crash or divide by zero
{
  const m = mergeHistograms([{bins:[], count:0, sum:0, min:0, max:0}]);
  check("case4 empty count", m.count, 0);
  check("case4 empty p50", m.p50_ms, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
