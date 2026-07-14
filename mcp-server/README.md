# loadstar-mcp

Drive Loadstar from Claude Code / Cursor in natural language.

A local **stdio** MCP server exposing Loadstar as tools. It is an HTTP client
of the existing `api` service — the same path `web/app.js` uses. It does not
touch the database and opens no new privileged route.

## Tools

| Tool | Route |
| --- | --- |
| `loadstar_get_config` | `GET /config` |
| `loadstar_list_tests` | `GET /tests` |
| `loadstar_create_test` | `POST /tests` |
| `loadstar_delete_test` | `DELETE /tests/:id` |
| `loadstar_run_test` | `POST /tests/:id/runs` |
| `loadstar_list_runs` | `GET /runs` |
| `loadstar_get_run` | `GET /runs/:id` |
| `loadstar_wait_for_run` | polls `GET /runs/:id` |
| `loadstar_stop_run` | `POST /runs/:id/cancel` |
| `loadstar_analyze_run` | `POST /runs/:id/analyze` |
| `loadstar_set_baseline` | `POST /runs/:id/baseline` |
| `loadstar_clear_baseline` | `DELETE /runs/:id/baseline` |
| `loadstar_get_report` | `GET /runs/:id/export/html` |

## Two safety behaviors worth knowing

**Debug traces are stripped by default.** `GET /runs/:id` returns
`debug_trace`, which stores real `Authorization` tokens in plaintext
(disclosed in SECURITY.md). Everything an MCP tool returns lands in an LLM
context window, so `debug_trace` is replaced with a placeholder. Override with
`LOADSTAR_EXPOSE_DEBUG_TRACE=true` only if you mean it.

**Timeseries are omitted.** Replaced with a point count; the metrics live in
`summary`. Stops a single `get_run` from flooding the context window.

## Setup

```bash
cd mcp-server
npm install
cp .env.example .env
```

Confirm `LOADSTAR_API_KEY_HEADER` matches whatever `apiKeyAuth` reads in
`api/src/middleware/security.js`. If tool calls come back 401, that is the line.

## Register with Claude Code

```bash
claude mcp add --transport stdio loadstar \
  --env LOADSTAR_API_URL=http://localhost:8080 \
  --env LOADSTAR_API_KEY=your-key \
  -- node /absolute/path/to/loadstar/mcp-server/src/index.mjs
```

All flags go BEFORE the server name; `--` separates them from the command.
Verify with `claude mcp list`, then `/mcp` inside a session.

Use an absolute path to `node` if you use nvm — Claude Code spawns the server
with a different shell environment than your terminal, so `node` may not be on
its PATH.

## Register with Cursor

In `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "loadstar": {
      "command": "node",
      "args": ["/absolute/path/to/loadstar/mcp-server/src/index.mjs"],
      "env": {
        "LOADSTAR_API_URL": "http://localhost:8080",
        "LOADSTAR_API_KEY": "your-key"
      }
    }
  }
}
```

## What it looks like in use

> "Create a 50-user load test against my staging URL for 60 seconds, run it,
> wait for it, and tell me whether it regressed against the baseline."

That is `get_config` → `create_test` → `run_test` → `wait_for_run` → `get_run`,
chained by the model on its own.

## Later: the remote transport

The SDK ships `server/streamableHttp.js` alongside `server/stdio.js`. To share
this beyond one machine, add a second entry point that calls the same
`registerLoadstarTools(server)` with that transport instead. The tools and the
HTTP client do not change — only `index.mjs` is stdio-specific. That is why
they are split.
