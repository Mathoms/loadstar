import { resolveDistribution } from "../sharding.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${g}${ok ? "" : `, want ${w}`}`);
  ok ? pass++ : fail++;
};

eq("auto 50vu → no dist", resolveDistribution({ virtual_users: 50, distribution_mode: "auto" }), { distribute: false, shards: 1 });
eq("auto 300vu → 3 shards", resolveDistribution({ virtual_users: 300, distribution_mode: "auto" }), { distribute: true, shards: 3 });
eq("no mode field → auto", resolveDistribution({ virtual_users: 300 }), { distribute: true, shards: 3 });
eq("off 500vu → no dist", resolveDistribution({ virtual_users: 500, distribution_mode: "off" }), { distribute: false, shards: 1 });
eq("on 20vu → 2 shards", resolveDistribution({ virtual_users: 20, distribution_mode: "on" }), { distribute: true, shards: 2 });
eq("on 300vu override 5 → 5 shards", resolveDistribution({ virtual_users: 300, distribution_mode: "on", shard_count_override: 5 }), { distribute: true, shards: 5 });
eq("on 10vu override 50 → 10 shards", resolveDistribution({ virtual_users: 10, distribution_mode: "on", shard_count_override: 50 }), { distribute: true, shards: 10 });
eq("on 5000vu override 999 → 10 shards", resolveDistribution({ virtual_users: 5000, distribution_mode: "on", shard_count_override: 999 }), { distribute: true, shards: 10 });
eq("on 1vu → no dist", resolveDistribution({ virtual_users: 1, distribution_mode: "on" }), { distribute: false, shards: 1 });
eq("on 300vu override 1 → auto (3)", resolveDistribution({ virtual_users: 300, distribution_mode: "on", shard_count_override: 1 }), { distribute: true, shards: 3 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
