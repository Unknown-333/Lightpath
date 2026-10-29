# ADR 0002: An in-process Node agent with zero dependencies, preloaded through `NODE_OPTIONS`

- Status: accepted
- Date: 2026-10-28; updated 2026-10-29 (D-085: `--require` instead of `--import`)

## Context

The Node side must collect coverage from the user's backend without code changes, on Windows, macOS, and Linux.

## Options

| Option                                                              | Pros                                                                             | Cons                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **In-process `node:inspector` Session via `NODE_OPTIONS=--require`** | No debug port; synchronous takes; works for child processes that inherit the env | Runs inside the user's process, so it must be tiny and must never throw                                                |
| `--inspect` and connect from the daemon over CDP                    | Agent-free                                                                       | Opens a debug port (security risk); port clashes with the user's own debugger; async round trips make boundaries fuzzy |
| `NODE_V8_COVERAGE`                                                  | Built in                                                                         | Writes only at process exit; no per-request boundaries                                                                 |

## Decision

Ship `@lightpath-dev/node-agent` as a single ES module, `register.js`, that the CLI adds to `NODE_OPTIONS` as `--require="<path>"` (D-085). The file is an ES module; Node 22.12+ loads it with `require()`.

- It has no npm dependencies. It uses `node:inspector`, `node:diagnostics_channel`, and the global `fetch` to send batches to the daemon (ADR 0006).
- It does nothing unless `LIGHTPATH_URL` and `LIGHTPATH_TOKEN` are set.
- Not `--import`: any `--import` makes Node run the main file through its ES module loader, which ignores `require` hooks, so `ts-node` and similar tools failed to start (measured on a real Fastify app, D-085).
- On Windows the path is written with forward slashes: `NODE_OPTIONS` drops backslashes inside quotes (measured).
- HTTP boundaries come from `http.server.request.start` and `http.server.response.finish`, which fire before and after the handler (measured).

## Consequences

- Every child process that inherits `NODE_OPTIONS` loads the agent, including package managers and build tools. The agent skips processes that don't match the app (by `argv`), and the daemon ignores agents that never send a delta.
- Minimum Node version is 22.12 (`diagnostics_channel` HTTP events, `require()` of ES modules, global `fetch`). Node 22.12 alone prints an experimental warning for that `require()`; 22.13+ is silent (measured). The CLI checks and explains.
- The agent can't use `ws`, zod, or `core`. Its messages are validated on the daemon side instead.
