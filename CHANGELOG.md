# Changelog

All notable changes to Lightpath are listed here. Versions follow [Semantic Versioning](https://semver.org/); before 1.0, any minor version can break things. Decision numbers (D-xxx) point into [decisions.md](decisions.md).

## [0.0.1] - 2026-10-30

The first release. On npm as the 7 `@lightpath-dev/*` packages (install with `npx @lightpath-dev/cli`), on the VS Code Marketplace as `lightpath-dev.lightpath-vscode`, and on PyPI as `lightpath-agent` (uploaded 2026-10-28). Tagged `v0.0.1`. Click something in your app and see every line of frontend and backend code it ran, in the terminal, in VS Code, and for your coding agent over MCP. It covers milestones M1 to M5 of the [roadmap](docs/ROADMAP.md).

Needs Node.js 22.12 or newer (D-099) and Chrome or Edge (D-031). The VS Code extension needs VS Code 1.101 or newer (D-071). The Python agent needs Python 3.12 or newer.

### Packages

| Package                          | What it is                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@lightpath-dev/cli`             | The `lightpath` command: `dev`, `doctor`, `mcp`                                                         |
| `@lightpath-dev/node-agent`      | In-process Node agent, loaded with `--require` through `NODE_OPTIONS`                                   |
| `@lightpath-dev/browser`         | Opens Chrome or Edge, marks each click, reads frontend coverage                                         |
| `@lightpath-dev/daemon`          | Joins frontend and backend coverage into one trace per action, on localhost only                        |
| `@lightpath-dev/core`            | Turns V8 coverage ranges into source lines through source maps                                          |
| `@lightpath-dev/mcp`             | MCP server for coding agents                                                                            |
| `@lightpath-dev/protocol`        | Wire protocol version 1 ([docs/PROTOCOL.md](docs/PROTOCOL.md))                                          |
| `lightpath-dev.lightpath-vscode` | VS Code extension                                                                                       |
| `lightpath-agent` (PyPI)         | Python agent with WSGI and ASGI middleware (0.0.1 was published on 2026-10-28 to claim the name, D-065) |

### Added

- `lightpath dev -- <your dev command>` runs your app with the Node agent preloaded (D-015, D-085), finds the app URL in the command's output (D-042), opens the browser, and prints each click and request with its files and lines.
- Coverage comes from V8 precise coverage deltas read at action boundaries, never on a timer (D-004 to D-006). Lines are mapped through inline and external source maps (D-010, D-076), including tsx's Windows paths (D-068, D-084) and webpack dev builds (D-087). Only workspace files are shown (D-012).
- A click starts at the press, or at the release on pages where reading coverage takes longer than 20 ms (D-024, D-082). Enter and Space are actions too (D-079). A full-page navigation stays in the action that caused it (D-080, D-091). A click ends after 300 ms without requests, at most 5 s (D-028).
- Requests the page makes are tagged with the trace id, same origin and any loopback port (D-029, D-086), and the backend's lines join the click's trace. Service workers are blocked in the browser Lightpath opens (D-089).
- Backend requests are bracketed with `diagnostics_channel` (D-016). Tested with Express, Fastify 5 and NestJS 12, run by type stripping, `tsx`, `tsx watch` and `tsc` output (D-073, D-077). Tool processes (Vite, webpack, nodemon, concurrently) are skipped (D-018, D-088).
- Files touched only by timers or polling are marked background and toned down (D-083).
- Clicks are labelled by the nearest control, and by a `data-testid` only outside any control (D-090, D-098).
- `lightpath doctor` checks Node, the browser, the agent file, the config file and the daemon.
- `lightpath.config.json` with a JSON Schema, checked strictly; flags win over the file (D-094). `ignore` globs leave files out of traces (D-095).
- `lightpath mcp` with `find_code_for_action`, `list_traces`, `get_trace` and `diff_traces` (D-096). Setup for Claude Code, Cursor, VS Code and Kiro is in the README.
- VS Code extension: heat decorations in 8 levels by hit count, `× N` gutter counts, the Actions view, Replay, Clear Highlights, Keep Highlights, and Pause or Resume Live Highlighting. It activates when `.lightpath/daemon.json` exists (D-039, D-040, D-093).
- Benchmarks in [bench/README.md](bench/README.md): 4 to 6 ms per backend request on the examples; a click pause under 12 ms p99 up to 3,000 React components; on Actual Budget (about 35,000 page functions) 15.9 / 19.8 ms p50 / p99 (D-078, D-081, D-097).

### Fixed during the 0.0.1 install test

- Frontend files showed as `no-source` after any full page reload (a first `lightpath dev` reloads once when Vite optimizes its dependencies). The browser collector now announces each script id, not only each new hash (D-101).
- `lightpath doctor` in a subfolder said the daemon was not running while `lightpath mcp` in the same folder found it. Both now look in the parents too (D-102).

### Known limits

See [Known limits](README.md#known-limits) in the README. In short: Chromium-based browsers only; overlapping requests in one process are marked, not separated; Web Workers, WebSocket messages, Next.js server components and worker threads aren't traced yet; bundled backends (esbuild, webpack) are untested; on very large pages the click starts at the mouse release, so `pointerdown` handlers are left out.
