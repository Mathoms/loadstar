# Loadstar architecture

## Components

```
 Browser (web UI, zero-build SPA)
    │  REST + polling (WebSocket streaming planned)
    ▼
 ┌─────────────┐        ┌──────────────────┐
 │  API (Node) │──SQL──▶│   PostgreSQL     │◀──SQL──┐
 │  express    │        │ tests/runs/audit │        │
 └─────────────┘        └──────────────────┘        │
    │ writes run row (status=queued)                │
    │                                     ┌─────────┴─────────┐
    │                                     │  Worker(s) (Node)  │
    │                                     │  claim → render JMX│
    │                                     │  → spawn JMeter    │
    │                                     │  → parse JTL       │
    │                                     │  → write summary   │
    │                                     └─────────┬─────────┘
    │                                               │ metrics only
    ▼                                               ▼
 Claude (Anthropic API) ◀────────── aggregated results for AI analysis
```

## Key decisions

**Queue-in-Postgres, not a message broker (for now).** Workers claim runs with
`FOR UPDATE SKIP LOCKED`, which is safe with N workers and zero extra
infrastructure. When run volume justifies it, swap the poll loop for
NATS/SQS without touching the execute/aggregate code.

**JMeter as engine, not as product.** Loadstar owns the UX (test intent → JMX
generation → parsed results). The engine is pluggable: `tests.engine` already
exists in the schema so k6 can slot in beside JMeter.

**Aggregate early.** Raw JTL files can be huge; only the summary and
per-second buckets are stored. For high-cardinality retention later, move
time series to ClickHouse or TimescaleDB — the JSONB column is a deliberate
MVP shortcut, isolated behind the worker's `parseJtl()`.

**AI at the edge of the data.** Claude receives only aggregated metrics —
never response bodies, headers, or credentials. Analysis is fail-soft: a
report is complete without it.

## Scaling path (maps to the roadmap)

| Stage | Change |
|---|---|
| More local load | `docker compose up --scale worker=N` |
| Geo-distributed load | Workers as a Kubernetes Deployment per region; region label on runs; results merged by run id |
| Private/on-prem generators | Same worker binary, outbound-only connection to the SaaS control plane (no inbound firewall holes) |
| Live streaming results | JMeter Backend Listener → worker → WebSocket to browser (replaces polling) |
| Big time series | ClickHouse/Timescale for buckets; Postgres keeps only summaries |
| Monitoring correlation | Prometheus remote-read at report time, overlay CPU/memory on the same time axis |
