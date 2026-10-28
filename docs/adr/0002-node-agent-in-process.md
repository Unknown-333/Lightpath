# ADR 0002: An in-process Node agent with zero dependencies, loaded with `--import`

- Status: accepted
- Date: 2026-10-28

## Context

The Node side must collect coverage from the user's backend without code changes, on Windows, macOS, and Linux.

## Options

| Option                                                              | Pros                                                                             | Cons                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **In-process `node:inspector` Session via `NODE_OPTIONS=--import`** | No debug port; synchronous takes; works for child processes that inherit the env | Runs inside the user's process, so it must be tiny and must never throw                                                |
| `--inspect` and connect from the daemon over CDP                    | Agent-free                                                                       | Opens a debug port (security risk); port clashes with the user's own debugger; async round trips make boundaries fuzzy |
| `NODE_V8_COVERAGE`                                                  | Built in                                                                         | Writes only at process exit; no per-request boundaries                                                                 |

## Decision

Ship `@lightpath/node-agent` as a single ES module, `register.js`, that the CLI adds to `NODE_OPTIONS` as `--import="<file URL>"`.

- It has no npm dependencies. It uses `node:inspector`, `node:diagnostics_channel`, and the global `fetch` to send batches to the daemon (ADR 0006).
- It does nothing unless `LIGHTPATH_URL` and `LIGHTPATH_TOKEN` are set.
- On Windows the import specifier must be a `file://` URL. A raw path fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` (measured).
- HTTP boundaries come from `http.server.request.start` and `http.server.response.finish`, which fire before and after the handler (measured).

## Consequences

- Every child process that inherits `NODE_OPTIONS` loads the agent, including package managers and build tools. The agent skips processes that don't match the app (by `argv`), and the daemon ignores agents that never send a delta.
- Minimum Node version is 22.12 (`diagnostics_channel` HTTP events, stable `--import`, global `fetch`). The CLI checks and explains.
- The agent can't use `ws`, zod, or `core`. Its messages are validated on the daemon side instead.
