import { splitIntoShards, shouldDistribute, shardCountFor } from "../sharding.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${g}${ok ? "" : `, want ${w}`}`);
  ok ? pass++ : fail++;
};
const sumVus = (shards) => shards.reduce((a, s) => a + s.virtual_users, 0);

// Even split
eq("300/3 vus", splitIntoShards(300, 3).map(s => s.virtual_users), [100, 100, 100]);

// Uneven — remainder to earliest shards, total exact
eq("100/3 vus", splitIntoShards(100, 3).map(s => s.virtual_users), [34, 33, 33]);
eq("100/3 total preserved", sumVus(splitIntoShards(100, 3)), 100);
eq("10/4 vus", splitIntoShards(10, 4).map(s => s.virtual_users), [3, 3, 2, 2]);

// Never more shards than VUs
eq("5 vus / 10 shards → 5 shards", splitIntoShards(5, 10).length, 5);
eq("5 vus / 10 shards each has 1", splitIntoShards(5, 10).every(s => s.virtual_users === 1), true);

// shard_index/count set correctly
eq("indices 0..2", splitIntoShards(9, 3).map(s => s.shard_index), [0, 1, 2]);
eq("count on each", splitIntoShards(9, 3).every(s => s.shard_count === 3), true);

// Distribution decision
eq("100 vus not distributed (=threshold)", shouldDistribute(100, 100), false);
eq("101 vus distributed", shouldDistribute(101, 100), true);

// Shard count sizing
eq("100 vus → 1 shard", shardCountFor(100, 100), 1);
eq("250 vus → 3 shards", shardCountFor(250, 100), 3);
eq("5000 vus capped at 10", shardCountFor(5000, 100, 10), 10);

// Edge: 1 VU, 1 shard
eq("1/1 vus", splitIntoShards(1, 1).map(s => s.virtual_users), [1]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
