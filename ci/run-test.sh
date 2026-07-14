#!/usr/bin/env bash
# Loadstar CI gate — queue a test run, wait for it, fail the build on regression.
#
# Usage:  LOADSTAR_URL=https://loadstar.yourco.com LOADSTAR_API_KEY=xxx ./run-test.sh <test-id>
# Exit codes: 0 = run passed SLA · 1 = SLA failed or run errored · 2 = usage/timeout
# Requires: curl, jq (preinstalled on GitHub-hosted runners)

set -euo pipefail

TEST_ID="${1:-}"
[ -z "$TEST_ID" ] && { echo "usage: run-test.sh <test-id>"; exit 2; }
BASE="${LOADSTAR_URL:-http://localhost:8080}"
AUTH=(-H "X-API-Key: ${LOADSTAR_API_KEY:-}")
TIMEOUT_SECS="${LOADSTAR_TIMEOUT:-1800}"

echo "▶ Loadstar: queuing run for test $TEST_ID on $BASE"
RUN_ID=$(curl -sf "${AUTH[@]}" -X POST "$BASE/api/tests/$TEST_ID/runs" | jq -r .id)
echo "  run id: $RUN_ID"

elapsed=0
while :; do
  RUN=$(curl -sf "${AUTH[@]}" "$BASE/api/runs/$RUN_ID")
  STATUS=$(echo "$RUN" | jq -r .status)
  case "$STATUS" in
    done|failed) break ;;
  esac
  [ "$elapsed" -ge "$TIMEOUT_SECS" ] && { echo "✗ timed out after ${TIMEOUT_SECS}s"; exit 2; }
  sleep 5; elapsed=$((elapsed + 5))
done

echo ""
echo "═══ Loadstar result: $STATUS ═══"
echo "$RUN" | jq -r '
  .summary as $s |
  if $s.test_type == "browser" then
    "  flows passed : \($s.flows_passed)/\($s.flows_total) (\($s.pass_rate)%)",
    "  avg flow     : \($s.avg_flow_ms) ms"
  else
    "  requests     : \($s.total_requests)",
    "  throughput   : \($s.throughput_rps) req/s",
    "  error rate   : \($s.error_rate)%",
    "  p95          : \($s.p95_ms) ms"
  end'
echo "$RUN" | jq -r '.ai_analysis.headline // empty | if . != "" then "  AI verdict   : " + . else empty end'

if [ "$STATUS" = "failed" ]; then
  echo "✗ Run failed: $(echo "$RUN" | jq -r .error)"; exit 1
fi

SLA=$(echo "$RUN" | jq -r .sla_passed)
if [ "$SLA" = "false" ]; then
  echo ""
  echo "✗ SLA FAILED — blocking the build:"
  echo "$RUN" | jq -r '.summary.sla.checks[] | "  \(if .ok then "✓" else "✗" end) \(.name) — actual \(.actual)"'
  exit 1
elif [ "$SLA" = "true" ]; then
  echo "✓ SLA passed."
else
  echo "ℹ No SLA set on this test — passing by default. Add thresholds in the Loadstar UI to gate builds."
fi
exit 0
