/**
 * Fixed-bucket latency histogram — shared by the worker and (for distributed
 * runs) the shard-merge logic. No side effects, so it can be unit-tested in
 * isolation without starting the worker loop.
 *
 * 1ms buckets up to 60s, then an overflow bin. Percentiles are computed from
 * the bin array alone — which is what makes distributed merging exact: summing
 * two histograms' bins element-wise and recomputing gives the TRUE combined
 * percentile. Averaging p95s never can.
 */
export const HIST_MAX = 60000;

export function makeHistogram() {
  const bins = new Int32Array(HIST_MAX + 1);
  let count = 0, sum = 0, min = Infinity, max = 0;
  return {
    add(ms) {
      count++; sum += ms;
      if (ms < min) min = ms;
      if (ms > max) max = ms;
      bins[Math.min(HIST_MAX, Math.max(0, Math.round(ms)))]++;
    },
    percentile(p) {
      if (!count) return 0;
      const target = Math.ceil((p / 100) * count);
      let cum = 0;
      for (let i = 0; i <= HIST_MAX; i++) { cum += bins[i]; if (cum >= target) return i; }
      return HIST_MAX;
    },
    get count() { return count; },
    get avg() { return count ? Math.round(sum / count) : 0; },
    get min() { return count ? Math.round(min) : 0; },
    get max() { return Math.round(max); },
    /* SPARSE snapshot. The dense form serialised all 60,001 bins (~120KB of
       JSON, almost entirely zeros). That was tolerable when there was ONE
       histogram per shard; per-endpoint means one per endpoint PER SHARD, and
       the dense form would push tens of megabytes through JSONB.

       A run's latencies occupy a few hundred distinct millisecond values, not
       60,001 — so emit only the non-zero bins. Typically ~300x smaller.
       PERCENTILES ARE IDENTICAL: they are computed from bin counts either way,
       which is precisely why the distributed merge is exact rather than an
       average of p95s. Nothing about accuracy changes here — only the wire size. */
    snapshot() {
      const sparse = [];
      for (let i = 0; i <= HIST_MAX; i++) {
        if (bins[i] !== 0) sparse.push([i, bins[i]]);
      }
      return { sparse, count, sum, min: count ? min : 0, max };
    },
  };
}

function percentileFromBins(bins, count, p) {
  if (!count) return 0;
  const target = Math.ceil((p / 100) * count);
  let cum = 0;
  for (let i = 0; i < bins.length; i++) { cum += bins[i]; if (cum >= target) return i; }
  return bins.length - 1;
}

/* Accepts BOTH snapshot forms:
     sparse (current):  { sparse: [[bin, count], ...], count, sum, min, max }
     dense  (legacy):   { bins: [c0, c1, ... c60000], count, sum, min, max }
   There are shard rows in the database written by the old dense format. A merge
   that silently ignored them would produce percentiles from a SUBSET of shards —
   an authoritative-looking wrong answer, which is the exact failure this project
   keeps finding. So both are read. */
export function mergeHistograms(shards) {
  const merged = new Int32Array(HIST_MAX + 1);
  let count = 0, sum = 0, min = Infinity, max = 0;
  for (const s of shards) {
    if (!s) continue;
    if (Array.isArray(s.sparse)) {
      for (const pair of s.sparse) {
        if (!Array.isArray(pair)) continue;
        const bin = pair[0], n = pair[1];
        if (bin >= 0 && bin <= HIST_MAX) merged[bin] += n;
      }
    } else if (Array.isArray(s.bins)) {
      for (let i = 0; i < merged.length && i < s.bins.length; i++) merged[i] += s.bins[i];
    } else {
      continue;
    }
    count += s.count || 0;
    sum += s.sum || 0;
    if ((s.count || 0) > 0) { if (s.min < min) min = s.min; if (s.max > max) max = s.max; }
  }
  return {
    bins: Array.from(merged),
    count, sum,
    min: count ? min : 0,
    max,
    avg_ms: count ? Math.round(sum / count) : 0,
    min_ms: count ? Math.round(min) : 0,
    max_ms: Math.round(max),
    p50_ms: percentileFromBins(merged, count, 50),
    p90_ms: percentileFromBins(merged, count, 90),
    p95_ms: percentileFromBins(merged, count, 95),
    p99_ms: percentileFromBins(merged, count, 99),
  };
}
