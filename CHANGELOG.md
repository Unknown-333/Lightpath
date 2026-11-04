# Changelog

All notable changes to Lightpath are listed here. Versions follow [Semantic Versioning](https://semver.org/); before 1.0, any minor version can break things. Decision numbers (D-xxx) point into [decisions.md](decisions.md).

## [0.1.2] - TBD (not published yet)

- Fix: resolve false-positive line attribution in un-taken else-if/switch branches and post-throw statements.
- Decisions: D-150 (the line rule), D-151 (lines after a call that threw are "unknown"), D-152 (which packages move to 0.1.2).

## [0.1.1] - 2026-11-04

Six fixes from the steps audit of the 2026-11-03 benchmark ([where the extra steps went](https://github.com/Unknown-333/Lightpath/pull/59)), the code that ran on request (`includeCode`), a security fix: `get_trace` showed secrets written in your source code, and the new logo. Needs Node.js 22.12 or newer, as before.

Whether these changes help an agent fix bugs, or fix them with fewer steps or credits, is not measured yet. The next benchmark tests it, under a rule set before any run. The sizes below are characters of tool output, measured without a model.

### Packages

Only packages whose published files changed get 0.1.1 (D-107, D-148). `npx @lightpath-dev/cli@0.1.1` installs browser and mcp 0.1.1 with the four 0.1.0 packages.

| Package                                                   | Version     | Why                                                                                                  |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `@lightpath-dev/mcp`                                      | 0.1.1       | Fixes 2 to 6, `includeCode`, the redaction fix                                                       |
| `@lightpath-dev/browser`                                  | 0.1.1       | Fix 1 (sign-in pages) and the `press` key of fix 2                                                   |
| `@lightpath-dev/cli`                                      | 0.1.1       | The `lightpath init` block's fix-check line (fix 6), the npm page README with the logo, the new deps |
| `@lightpath-dev/protocol`, `core`, `node-agent`, `daemon` | stay 0.1.0  | Their tarballs are byte for byte the same as 0.1.0's                                                 |
| VS Code extension `lightpath-dev.lightpath-vscode`        | stays 0.0.1 | Not republished (D-137). Its icon changed in the repo only; the Marketplace copy keeps the old look  |
| `lightpath-agent` (PyPI)                                  | stays 0.0.1 | Nothing in `agents/python` changed                                                                   |

### Security

- **Fixed: `get_trace` returned secrets written in your source code.** In 0.1.0, `get_trace` with a `file` or `function` showed source lines exactly as written. A hard-coded API key, token or password in a traced file went to the agent as is (D-123 redacted runtime text only). In 0.1.1 every piece of source code a tool returns is redacted, in `get_trace` slices and in the `includeCode` section, whether `includeCode` is set or not. Bearer tokens, JWT-like strings, well-known key formats (Stripe, AWS, GitHub, Slack, Google), PEM private keys, secret query values, and string literals named with a secret word (`apiKey = "…"`) become `[redacted]`. Values that `run_action` filled are hidden in the code as well (D-145, D-146). If you used 0.1.0's `get_trace` on code with hard-coded secrets, treat those secrets as seen by your agent and its model provider.

### Changed

- Fix 1: a `run_action` miss on a page with a password field says the page is a sign-in form and gives a ready `run_action` call built from its own fields, with `<placeholder>` values (D-139).
- Fix 2: `run_action`'s schema is shorter. Kiro's `tool_load` text for it goes from 2,409 to 2,091 characters. The daemon checks the bounds the schema no longer repeats. `press: "Enter" | "Space"` replaces `action: "press"` plus `key`. This breaks calls that use the old keys: they now click instead of pressing (D-140).
- Fix 3: a trace with 3 or more backend requests shows each backend file that ran in 3 or more of them once, with request counts, instead of under every request. On a tududi Login trace (13 requests) that is 14,810 → 11,441 characters, with the same files left out (D-141).
- Fix 5: `find_code_for_action` with nothing recorded answers with the `run_action` call that records it, such as `run_action {"target":"Set in progress"}` (D-143).
- The `@lightpath-dev/cli` npm page shows the new logo and the tududi demo GIF.

### Added

- Fix 4: `run_action` takes `times` (1 to 5). It does the same action that many times and returns one trace with the counts added up. Pressing "Add to cart" twice on the shop goes from 2 calls and 888 characters to 1 call and 633 (D-142).
- Fix 6: `run_action` takes `compareTo` (a trace id, or `"last"` for the newest earlier trace of the same action). The answer adds the function-level diff, so checking a fix is one call. The server instructions and the `lightpath init` block now point to it instead of `diff_traces` (D-144).
- `run_action` and `get_trace` take `includeCode` (opt-in, off by default). With `includeCode: true`, the trace answer ends with the code of the lines that ran: each file's executed lines with their numbers, not-run lines folded as `// not run: lines A-B`, most-used files first, inside the same 16,000-character cap. A last line names what was left out and the `get_trace` call for it. With it, the shop's Checkout answer goes from 1,114 to 6,619 characters, and `examples/invoices`' "Mark as paid" from 1,549 to 10,900. Without it, answers are the same as before (D-145, D-146).
- `get_trace` and `diff_traces` check trace ids, and `get_trace` its `page`, in the tool instead of the schema, and `run_action`'s `timeoutMs` has no description. That keeps `tools/list` under 4,000 characters with `includeCode` (3,990, D-146).
- The Lightpath logo (a path mark in indigo and pink, built in code as SVG) in the README, on the npm page and on the site. Sources and the build are in `brand/logo/`.

### Tests

- A new CI end-to-end test, `scripts/e2e-invoices-fix.mjs`, plants the demo bug in `examples/invoices`, fixes it, and checks that one `run_action` call with `compareTo: "last"` shows `getSummary` running its summing lines again (D-144).
- `scripts/e2e-invoices.mjs` checks that a default answer has no code, and that `get_trace` with `includeCode: true` returns it (D-146).

## [0.1.0] - 2026-11-04

Your coding agent can now run the loop itself: click something in your app, get the code that ran, look closer, fix, and check the fix. All 7 npm packages move to 0.1.0, because every one of them ships changed files (D-133). The VS Code extension stays at 0.0.1, which still reads 0.1.0 traces (D-137). Needs Node.js 22.12 or newer, as before.

### Benchmark

Lightpath did not raise the fix rate, and runs with it cost more. Kiro CLI 2.37.0 with `claude-sonnet-5.5` fixed seeded bugs in two suites, with and without Lightpath, scored by rules committed before any run ([full write-up](bench/agent-suite/results/2026-11-03-full-benchmark.md)):

| Set                     | Fixed without | Fixed with                     | Steps per run, without → with | Credits per run, without → with |
| ----------------------- | ------------- | ------------------------------ | ----------------------------- | ------------------------------- |
| Shop, 7 visible bugs    | 21 of 21      | 20 of 21 (21 without the flaw) | 5.00 → 7.10                   | 0.317 → 0.493                   |
| tududi, 3 visible bugs  | 15 of 15      | 15 of 15                       | 9.87 → 13.47                  | 0.980 → 1.329                   |
| Shop, 3 held-out bugs   | 9 of 9        | 9 of 9                         | 5.67 → 6.56                   | 0.339 → 0.434                   |
| tududi, 2 held-out bugs | 9 of 10       | 6 of 10 (7 without the flaw)   | 12.50 → 13.44                 | 1.116 → 1.333                   |
- "The flaw": the scoring's void check wrongly flagged 5 runs on paths inside the trial. By the rules as written, 2 of them count as not fixed. The rules weren't changed after results came in; both numbers are given.
- With Lightpath, the agent called it by itself in 31 of 53 valid runs (D-134).
- tududi has only 3 visible bugs, and all 5 of its fixes are public on GitHub, so the model may have seen them in training. One held-out bug, h01, accounts for the tududi held-out drop.
- One agent and one model were run. Token counts are estimates (D-111).

### Added

- **`run_action`**: a new MCP tool. The agent names a button or link (`button "Checkout"`, visible text, or `css=…`), and Lightpath clicks it, or presses Enter or Space, in the browser it opened. The answer is that action's trace, frontend and backend, in one call. It can fill form fields first; the values it types never show up in any output. It runs on 127.0.0.1 with the daemon's token, through a new `POST /v1/action` endpoint, and opens no debug port (D-113, D-114, D-115, D-127, [ADR 0007](docs/adr/0007-run-action.md)).
- **Compact output by default**: every tool answer is at most 16,000 characters, about 4,000 tokens (D-109). A trace now reads as a list of functions, grouped by what ran before the request, on the server, and after the response, each with its line range, call count and the lines that didn't run (D-116, D-128). When a trace is too big, whole files are left out, least-used first, and the last line says how to see them.
- **A deeper look on request**: `get_trace` with a `file` or a `function` shows the lines that ran, with the ones that didn't run folded and marked, in pages (D-117).
- **Fix checking**: `diff_traces` compares two traces by function, not line number, so a fix that moves lines still compares: which functions and branches ran in only one, changed call counts, changed request status, errors that appeared or went away (D-118).
- **`lightpath init --agent <claude-code|cursor|vscode|kiro>`**: one command per agent writes its MCP config and a short `AGENTS.md` block that says when to use Lightpath. `lightpath doctor` checks what init wrote. CI tests all four on Windows, macOS and Linux with no agent installed (D-120).
- **Errors in traces**: thrown errors, `console.error`, failed requests (status 400 and up, or network errors) and a Node server's crash show in the trace of the action they belong to, as counts plus the first message (D-121, D-132).
- **Auto-start**: with `"autoStart": true` in `lightpath.config.json` (`lightpath init` writes it), `lightpath mcp` starts `lightpath dev` by itself the first time a tool needs it, and stops it when the agent closes. Every answer from that first call says the command it ran (D-122).
- **`run_request`**: a new MCP tool for API-only backends. The agent sends one HTTP request to the app on localhost and gets the backend code it ran, with no browser. It sends only to `localhost`, `127.0.0.1` or `[::1]`, follows no redirect and uses no proxy (D-125).
- The MCP server tells agents what Lightpath is for, in its `instructions`, and its six tool descriptions start with what each tool does (D-119, D-129).
- `mcpName` in `@lightpath-dev/cli`'s `package.json`, for the Official MCP Registry.

### Security

- **Secrets hidden** in everything a tool returns: query values and `key=value` pairs whose name holds `token`, `key`, `secret`, `pass`, `auth`, `session` or `sig`, `Bearer` tokens, and JWT-like strings become `[redacted]`. Request and response bodies and headers are never collected. Your source code, shown by `get_trace`, isn't changed (D-123).

### Fixed

- `lightpath dev --url <url>` opened the page before the dev server was listening, and nothing retried, so no browser opened. It now waits until the URL answers, up to 60 s (D-126).
- The VS Code editor test failed now and then at its Replay check on a Windows desktop. It now checks the tab in front instead of an editor event that VS Code doesn't always send. Test only (D-131).

### Changed

- Wire protocol, still version 1 (every addition is optional): `POST /v1/action`, the `problem` ingest message, `beforeRequest` on browser deltas, and `phases`, `functions`, `problems` on traces ([docs/PROTOCOL.md](docs/PROTOCOL.md)).
- Config: a new key, `autoStart` (D-122).
- The browser reads coverage once more per action, as its first request leaves the page: 27.99 / 38.82 ms p50 / p99 on Actual Budget, measured on a busy machine ([bench/README.md](bench/README.md), D-128).

## [0.0.2] - 2026-10-30

A fix for the browser collector. Only the npm packages whose published files changed get 0.0.2: `@lightpath-dev/browser` and `@lightpath-dev/cli` (D-107). `npx @lightpath-dev/cli@0.0.2` installs browser 0.0.2 with the 0.0.1 packages below.

### Fixed

- On a busy page, the coverage read right after `load` could take longer than the 20 ms press budget and move the click boundary to the mouse release before the first click. Then `pointerdown` and `mousedown` code was left out of every click's trace (Actual Budget: 1 run in 3). Now only a read at a pointer press moves the boundary (D-105).
- The D-085 require-hook test failed when run from a color terminal, because the child process printed `true` in color. It now ignores color codes. Test only; no package changed.

### Docs

- `@lightpath-dev/cli` has a README for its npm page.
- [bench/README.md](bench/README.md): the press pause on Actual Budget after D-105 is 15.00 / 17.73 ms p50 / p99, most of it Chrome reading coverage, and it stays as it is (D-106).

### Stays at 0.0.1

`@lightpath-dev/protocol`, `@lightpath-dev/core`, `@lightpath-dev/node-agent`, `@lightpath-dev/daemon`, `@lightpath-dev/mcp`, and the VS Code extension `lightpath-dev.lightpath-vscode`: nothing they ship changed (D-107).

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
