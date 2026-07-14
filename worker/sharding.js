/**
 * Split a run's load across N generators. Pure logic, no I/O — unit-tested in
 * isolation. Each shard gets a slice of the virtual users; the ramp-up window
 * stays the same wall-clock length so the overall load shape is preserved
 * (every generator ramps its own slice over the same seconds).
 *
 * VUs rarely divide evenly: 100 VUs / 3 generators = [34, 33, 33]. The
 * remainder goes to the earliest shards so the total is always exact.
 */
export function splitIntoShards(virtualUsers, shardCount) {
  const vus = Math.max(0, Math.floor(Number(virtualUsers) || 0));
  const n = Math.max(1, Math.floor(Number(shardCount) || 1));
  // Never create more shards than there are VUs — an empty shard does no work.
  const effective = Math.min(n, Math.max(1, vus));
  const base = Math.floor(vus / effective);
  const remainder = vus % effective;
  const shards = [];
  for (let i = 0; i < effective; i++) {
    shards.push({
      shard_index: i,
      shard_count: effective,
      virtual_users: base + (i < remainder ? 1 : 0),
    });
  }
  return shards;
}

/**
 * Decide whether a run should be distributed at all. Below the threshold a
 * single worker is fine and sharding just adds coordination overhead.
 */
export function shouldDistribute(virtualUsers, maxPerGenerator = 100) {
  return Number(virtualUsers) > Number(maxPerGenerator);
}

/** How many shards for a given VU count, capped so each carries a sane load. */
export function shardCountFor(virtualUsers, maxPerGenerator = 100, maxShards = 10) {
  const vus = Math.max(0, Math.floor(Number(virtualUsers) || 0));
  if (vus <= maxPerGenerator) return 1;
  return Math.min(maxShards, Math.ceil(vus / maxPerGenerator));
}

/**
 * Resolve whether/how a test distributes, honouring the user's stored
 * preference. Pure — no I/O. Returns { distribute, shards }.
 *   'off'  → never distribute
 *   'on'   → always distribute (>=2 shards); shards = override if set, else auto
 *   'auto' → current behaviour: distribute above threshold, auto shard count
 * Shards are always capped at virtual_users (no empty shards) and at maxShards.
 */
export function resolveDistribution(t, maxPerGenerator = 100, maxShards = 10) {
  const vus = Math.max(0, Math.floor(Number(t.virtual_users) || 0));
  const mode = t.distribution_mode || "auto";

  if (mode === "off") return { distribute: false, shards: 1 };

  if (mode === "on") {
    const override = Number(t.shard_count_override);
    let shards = Number.isFinite(override) && override > 1
      ? Math.min(override, maxShards, Math.max(1, vus))
      : shardCountFor(vus, maxPerGenerator, maxShards);
    if (shards < 2) shards = Math.min(2, Math.max(1, vus)); // force-on wants >=2 if possible
    return { distribute: shards >= 2, shards };
  }

  // auto (unchanged from prior behaviour)
  if (!shouldDistribute(vus, maxPerGenerator)) return { distribute: false, shards: 1 };
  return { distribute: true, shards: shardCountFor(vus, maxPerGenerator, maxShards) };
}
