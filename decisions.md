# Decisions log

Every meaningful decision made while changing Lightpath's code, with why it was made and how it was done. Newest entries go at the bottom of each section. Big, hard-to-reverse decisions also get a full write-up in [`docs/adr/`](docs/adr); this log links to them.

## How to add an entry

Add one whenever a change picks between real options: a new dependency, a new file format, a behavior users will notice, a workaround for a platform quirk, or a test strategy. Use the next free number and this shape:

```
### D-0NN Short title
- Date: YYYY-MM-DD
- Decision: what we chose, in one sentence.
- Why: the reason, with the measurement or source if there is one.
- How: where and how it's implemented (files, functions).
- Rejected: the alternatives and why they lost.
```

"Measured" means we ran it and saw the result on Node 24.13, Python 3.13.5, and Chrome 156 on Windows, on October 28, 2026.

---

## 1. Product and scope

### D-001 Build Lightpath

- Date: 2026-10-28
- Decision: Build a tool that lights up, in the editor, every frontend and backend line that ran for one click.
- Why: It had the clearest demo and the least line-level competition of the ideas researched (see the research notes kept outside git). It answers a daily question, "what ran when I clicked this?", in unfamiliar or AI-written code.
- How: Monorepo with agents for the browser, Node, and Python, a local daemon, and editor, terminal, and MCP clients.
- Rejected: Python time-travel debugger (several small projects already active), Platen (better for revenue, weaker hiring signal), others listed in the research notes.

### D-002 Local only, development only

- Date: 2026-10-28
- Decision: Lightpath never sends data off the machine and is not meant for production.
- Why: Agents read source code. Precise coverage also disables V8's optimized code, so apps run slower.
- How: The daemon binds to `127.0.0.1`; agents refuse non-loopback daemon URLs (D-021); the README states the slowdown.
- Rejected: A hosted mode. It can come later if users ask.

### D-003 Publish under the `@lightpath` npm scope and as `lightpath-agent` on PyPI

- Date: 2026-10-28
- Decision: npm packages are `@lightpath/*` with `@lightpath/cli` providing the `lightpath` command; the Python package is `lightpath-agent`.
- Why: `lightpath` is already taken on both npm (a browser HTTP wrapper) and PyPI. The scope and `lightpath-agent` were free when checked.
- How: Package names in each `package.json` and `agents/python/pyproject.toml`.
- Rejected: Renaming the project. The name fits and only the bare package names were taken.

---

## 2. Core technique

### D-004 Use V8 precise coverage deltas ([ADR 0001](docs/adr/0001-v8-coverage-deltas.md))

- Date: 2026-10-28
- Decision: Start precise coverage once, then read it at the start and end of each action.
- Why: The DevTools docs say `takePreciseCoverage` "resets execution counters", so the second read is exactly what ran in between. Measured: deltas list only functions that ran.
- How: `Profiler.startPreciseCoverage` and `Profiler.takePreciseCoverage` in `packages/node-agent/src/inspector.ts` and `packages/browser/src/collector.ts`.
- Rejected: Babel/Istanbul instrumentation (needs a build plugin per framework), stepping through code with a debugger (far too slow), OpenTelemetry (request level, not line level), CPU sampling (misses short code).

### D-005 Turn on block coverage and call counts

- Date: 2026-10-28
- Decision: Start coverage with `{ callCount: true, detailed: true }`.
- Why: Without `detailed`, V8 reports whole functions only, so an `if` branch that didn't run would still look covered. `callCount` gives the hit counts that drive heat levels.
- How: Both collectors pass these options.
- Rejected: Function-level coverage. Kept as a fallback idea if block coverage ever proves too slow.

### D-006 Read coverage only at boundaries, never on a timer

- Date: 2026-10-28
- Decision: Read coverage only when a click or request starts and ends.
- Why: Measured: one read costs time for every compiled function, not just those that ran: about 0.75 ms with 1,000 functions, 5 ms with 10,000, and 28 ms with 50,000.
- How: Agents read in `onRequestStart`, `onResponseFinish`, and the browser's click handling. No timers read coverage.
- Rejected: Polling and splitting by time. Expensive and fuzzy.

---

## 3. Line mapping (`packages/core`)

### D-007 Innermost range wins

- Date: 2026-10-28
- Decision: When ranges nest, the count of the innermost range applies to each byte.
- Why: Measured: V8 reports a function's whole span first, then blocks inside it, including untaken branches and closures that didn't run, with `count: 0`. Taking the innermost range is what c8 does too.
- How: `flattenRanges` in `src/flatten.ts` sorts ranges outer-first and sweeps with a stack. Tested against a brute-force reference on 300 random trees.
- Rejected: Adding counts together. It double counts nested blocks.

### D-008 A line's count is the maximum of its segments, and only real code counts

- Date: 2026-10-28
- Decision: A line takes the highest count of any segment touching its non-whitespace text. Blank lines and gaps between functions get no value.
- Why: A loop body that ran 10 times should show 10, not 10 plus its loop test's 11. Leading indentation shouldn't make a line look covered.
- How: `rangesToLines` in `src/lines.ts`, using `LineIndex.content()` from `src/line-index.ts`.
- Rejected: Summing segments; counting whitespace.

### D-009 Offsets are UTF-16 code units

- Date: 2026-10-28
- Decision: Treat V8 offsets as JavaScript string indexes, never UTF-8 byte positions.
- Why: That's what V8 and source maps use. Measured with a file containing emoji and CJK text: lines map correctly.
- How: `LineIndex` scans the source string with `charCodeAt`. The test is in `test/lines.test.ts`.
- Rejected: Indexing into a UTF-8 buffer. Every line after non-ASCII text would shift.

### D-010 Map through source maps by walking every mapping

- Date: 2026-10-28
- Decision: For each mapping in the source map, look up the count at its generated position, and give that count to its original line.
- Why: Mapping only the start of each generated line misses code that moved during transpiling. Generated code with no mapping (JSX runtime imports, hot-reload glue) is dropped automatically, which is correct.
- How: `mapToOriginal` in `src/sourcemap.ts` uses `eachMapping` from `@jridgewell/trace-mapping` with `countAt`.
- Rejected: `originalPositionFor` on line starts.

### D-011 Count what can't be mapped instead of guessing

- Date: 2026-10-28
- Decision: Scripts that can't be mapped are tallied by reason (`node_modules`, `outside-workspace`, `no-source`, `no-source-map`, `internal`) and shown as "hidden".
- Why: A wrong highlighted line destroys trust faster than a missing one.
- How: `resolveFile` in `src/resolve.ts` returns a drop reason; `mapScript` in `src/pipeline.ts` and the daemon's correlator count them into `Trace.dropped`.
- Rejected: Falling back to the generated file or the file on disk, which may have changed since.

### D-012 Show only workspace files

- Date: 2026-10-28
- Decision: A file is shown only if it resolves inside a workspace root. Windows paths compare case-insensitively; a sibling folder with the same prefix doesn't count.
- Why: Users care about their own code, not dependencies or Node internals.
- How: `resolveFile` handles `file://` URLs, Vite dev URLs with query strings, Vite's `/@fs/` prefix, and Windows drive letters.
- Rejected: A deny list only. Allowing just the workspace is safer and simpler.

### D-013 Logarithmic heat levels

- Date: 2026-10-28
- Decision: Eight heat levels, from `floor(log2(count))`, capped at the hottest.
- Why: One hot loop shouldn't wash out everything else.
- How: `heatBucket` in `src/ids.ts`, used by the VS Code extension.
- Rejected: Linear scaling.

---

## 4. Node agent (`packages/node-agent`)

### D-014 An in-process agent with zero dependencies ([ADR 0002](docs/adr/0002-node-agent-in-process.md))

- Date: 2026-10-28
- Decision: The agent runs inside the user's Node process, loaded with `--import`, and uses only Node built-ins.
- Why: Measured: an in-process inspector session answers synchronously, so a coverage read is a plain function call with clean boundaries. Any npm dependency could clash with the app's own versions.
- How: `node:inspector`, `node:diagnostics_channel`, and the global `fetch`. `@lightpath/protocol` is a dev dependency used for types only.
- Rejected: `--inspect` with the daemon connecting over a debug port (security risk, port clashes, asynchronous and fuzzy boundaries), `NODE_V8_COVERAGE` (writes only at process exit).

### D-015 Load the agent with a quoted `file://` URL, appended to `NODE_OPTIONS`

- Date: 2026-10-28
- Decision: The CLI adds `--import="file:///…/register.js"` to the end of the user's `NODE_OPTIONS`.
- Why: Measured on Windows: a raw `C:\` path fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`; a quoted URL with `%20` for spaces works. Users may already have their own options.
- How: `registerUrl` in `src/index.ts`; `withImport` and `agentEnv` in `packages/cli/src/env.ts`.
- Rejected: Replacing `NODE_OPTIONS`.

### D-016 Bracket requests with diagnostics channels

- Date: 2026-10-28
- Decision: Use the built-in `http.server.request.start` and `http.server.response.finish` channels.
- Why: Measured: start fires before the route handler and finish fires after the response, on every Node HTTP server (Express, Fastify, and plain `http`).
- How: `startAgent` in `src/start.ts` subscribes; `Agent` in `src/agent.ts` reads coverage on each.
- Rejected: Patching `http.createServer`, which breaks easily and differs by framework.

### D-017 The agent never breaks or blocks the app

- Date: 2026-10-28
- Decision: Every entry point catches errors; the agent does nothing without `LIGHTPATH_URL` and `LIGHTPATH_TOKEN`; it skips package managers and build tools.
- Why: It runs inside other people's processes.
- How: `register.ts` and `startAgent` wrap everything in try/catch; `guard()` wraps channel callbacks; `readConfig` in `src/config.ts` has the skip list; `LIGHTPATH_DEBUG=1` turns on logging.
- Rejected: Failing loudly.

### D-018 Skip tool processes by command line

- Date: 2026-10-28
- Decision: Skip processes whose command line looks like npm, pnpm, yarn, corepack, Vite, TypeScript, esbuild, Vitest, Playwright, Biome, or the `tsx` CLI.
- Why: Every child of `lightpath dev` inherits `NODE_OPTIONS`, including Vite's own server, which would otherwise report its own code.
- How: `DEFAULT_SKIP` regexes in `src/config.ts`, plus a user regex in `LIGHTPATH_SKIP`. The `tsx` CLI is skipped, but the child it starts to run your file is instrumented.
- Rejected: Asking users to list their app process.

### D-019 Push each script's source once, only for workspace files, only with inline source maps

- Date: 2026-10-28
- Decision: The first time a workspace script appears in a delta, the agent sends its source and info. External source map URLs are not forwarded.
- Why: The daemon must turn offsets into lines using the exact text V8 ran, not the file on disk. Sending only workspace files keeps `node_modules` code in the process. Letting agents name a map file would make the daemon read paths that agents supply.
- How: `#pushSources` and `#inWorkspace` in `src/agent.ts`, deduplicated by script hash. The protocol schema only accepts `data:` map URLs.
- Rejected: Having the daemon ask for sources (needs a listener in the app), and sending every script.

### D-020 Mark overlapping requests instead of separating them

- Date: 2026-10-28
- Decision: If two requests overlap in one process, both are marked overlapped.
- Why: V8 counts per process, not per request, so there's no way to separate them.
- How: The in-flight map in `src/agent.ts` records the other trace IDs; the UI shows an "overlapped" badge.
- Rejected: Pretending the deltas are accurate.

### D-021 Talk only to localhost

- Date: 2026-10-28
- Decision: Agents refuse to start if `LIGHTPATH_URL` isn't `127.0.0.1`, `localhost`, or `[::1]`.
- Why: A wrong environment variable must never send source code across a network.
- How: `readConfig` in `packages/node-agent/src/config.ts` and `read_config` in `agents/python/src/lightpath_agent/config.py`.

---

## 5. Agent-to-daemon transport

### D-022 Agents POST batches over HTTP and hold no connection ([ADR 0006](docs/adr/0006-agent-ingest-over-http.md))

- Date: 2026-10-28
- Decision: Agents queue messages and send them as `IngestBatch` bodies to `POST /v1/ingest`. This replaced the first design, a WebSocket per agent.
- Why: An open socket would keep the user's event loop alive, so scripts and test runs would never exit. The test in `packages/node-agent/test/agent.integration.test.ts` checks that the app process exits on its own.
- How: `Transport` in `packages/node-agent/src/transport.ts` (timer `unref()`ed, backoff, keeps up to 1,000 queued messages); Python's `transport.py` uses a background thread.
- Rejected: WebSocket from agents; the daemon asking agents for sources.

### D-023 One ingest path for all three collectors

- Date: 2026-10-28
- Decision: Node, browser, and Python messages share one schema and one correlator entry point.
- Why: One place to validate and one place to test.
- How: `IngestMessage` in `packages/protocol/src/messages.ts`; `Correlator.ingest` in `packages/daemon/src/correlator.ts`. The browser collector runs inside the CLI, so it calls `ingest` directly instead of over HTTP (D-041).

---

## 6. Browser collector (`packages/browser`)

### D-024 Mark the click with a `debugger;` pause in our own first listener ([ADR 0003](docs/adr/0003-click-boundary.md))

- Date: 2026-10-28
- Decision: An init script adds the first capture `pointerdown` listener on `window`. It saves the target's description and runs `debugger;`. The collector reads coverage while the page is paused, then resumes.
- Why: The read has to happen before any app handler runs. Measured: pauses last 4.7 to 7.1 ms.
- How: `HOOK_SOURCE` in `src/collector.ts`, added with `page.addInitScript`.
- Rejected (both tried): Playwright `exposeBinding`, which is asynchronous, so the click handler landed in the background delta (measured failure). A DOM event-listener breakpoint, which works but pauses before every listener, including Playwright's own.

### D-025 Identify our pause by script, and resume all others

- Date: 2026-10-28
- Decision: A pause is ours only if its frame's script is `lightpath://hook.js`. Every other pause is resumed at once.
- Why: Measured: `CallFrame.url` is empty for init scripts, so the URL must be looked up from `Debugger.scriptParsed` by script ID. Apps may contain `debugger;` statements, and Lightpath must not freeze them.
- How: `Debugger.paused` handler and `#onPaused` in `src/collector.ts`.

### D-026 Do as little as possible while paused

- Date: 2026-10-28
- Decision: While paused, only read coverage, read the target, and set the active trace ID. Everything else happens after resuming.
- Why: Measured: Chrome drops `pointerup`, `mouseup`, and `click` events that arrive while the page is paused. A human press lasts 50 to 150 ms, so the pause must stay short.
- How: `#click` runs the read and the target lookup in parallel with `Promise.all`, then resumes.

### D-027 Set the trace ID before resuming

- Date: 2026-10-28
- Decision: `#active` is set before the page resumes.
- Why: The click handler's own `fetch` calls must carry the trace header. An earlier version set it too late and the first request went untagged (measured failure).
- How: `#click` in `src/collector.ts`.

### D-028 A click ends after 300 ms without requests, capped at 5 s

- Date: 2026-10-28
- Decision: The settle window ends when no requests are in flight for 300 ms, or 5 s after the click.
- Why: Network calls and the re-render that follows belong to the click. WebSockets, event streams, and media never finish, so they don't count.
- How: `SettleTracker` in `src/settle.ts`; `countsTowardSettle` in `src/rules.ts`.

### D-029 Tag only same-origin fetch and XHR requests ([ADR 0004](docs/adr/0004-request-correlation.md))

- Date: 2026-10-28
- Decision: Add `x-lightpath-trace` only to fetch and XHR requests going to the app's own origin, plus any origin the user lists.
- Why: A custom header on a cross-origin request triggers a CORS preflight and changes how the app behaves. Vite proxies `/api` to the backend, so same-origin covers the common setup.
- How: `shouldTag` in `src/rules.ts`, applied in `#onRoute` through `page.route`.
- Rejected: W3C `traceparent` (clashes with apps' own tracing), matching requests by time only (wrong when a background poll lands inside a click).

### D-030 Send each action delta before its trace end

- Date: 2026-10-28
- Decision: The collector waits for its sources and action delta to be sent before sending `traceEnd`.
- Why: Clients treat `traceEnd` as "finished". Before this fix, a Checkout trace was printed without its frontend files (measured in the end-to-end test).
- How: `#emit` is awaited in `#click`.

### D-031 Use the browser the user already has

- Date: 2026-10-28
- Decision: Launch installed Chrome, then Edge, then Playwright's own Chromium.
- Why: No large download on first run.
- How: `launchBrowser` in `src/launch.ts`; it lists every attempt in its error message.

---

## 7. Daemon (`packages/daemon`)

### D-032 Lock the daemon down

- Date: 2026-10-28
- Decision: Listen on loopback only, require a 32-byte random token, reject any request with an `Origin` header, cap bodies at 8 MB, and validate every message.
- Why: The daemon receives source code. Web pages in the user's own browser could otherwise reach `127.0.0.1`, and browsers always send `Origin`.
- How: `newToken`, `tokensEqual` (constant-time), and `authorize` in `src/auth.ts`; `route()` in `src/server.ts`. Tests cover 401, 403, 400, and 204.

### D-033 Clients find the daemon through a discovery file

- Date: 2026-10-28
- Decision: The daemon writes `.lightpath/daemon.json` (port, token, pid) in the first workspace root, with a `.gitignore` containing `*` next to it.
- Why: The extension and MCP server start independently and need the port and token without the user copying them. The token must never be committed.
- How: `writeDiscovery` in `src/discovery.ts`, with mode 0600 on Unix. Removed when the daemon closes.

### D-034 Keep traces in memory for now

- Date: 2026-10-28
- Decision: A ring buffer of the last 200 traces, behind a `Store` interface.
- Why: Measured: `node:sqlite` works but still prints `ExperimentalWarning` on Node 24.13.
- How: `MemoryStore` in `src/store.ts`. A `SqliteStore` can be added later behind the same interface.

### D-035 A browser trace ends only with its `traceEnd`

- Date: 2026-10-28
- Decision: Backend deltas add files to a browser trace but never mark it finished. A `traceStart` that arrives after a backend delta merges into it instead of replacing it.
- Why: Measured in the end-to-end test: the backend reply arrives in the middle of a click, which made the trace look done before the frontend code was in it.
- How: `#onDelta` and the `traceStart` case in `src/correlator.ts`. Two tests in `test/correlator.test.ts`.

### D-036 Ignore background deltas for now

- Date: 2026-10-28
- Decision: Deltas marked `background` never become traces.
- Why: They hold timers and hot-reload code. They'll later feed noise filtering.
- How: First line of `#onDelta`.

---

## 8. Clients

### D-037 One daemon client for every TypeScript client

- Date: 2026-10-28
- Decision: `DaemonClient` lives in `@lightpath/protocol` and uses the global `WebSocket`.
- Why: Measured: Node's and VS Code's built-in `WebSocket` sends no `Origin` header, so it passes the daemon's check. It also keeps the `ws` package out of the extension bundle.
- How: `packages/protocol/src/client.ts`, used by the CLI tests, the MCP server, and the extension.

### D-038 The MCP server reconnects on every tool call

- Date: 2026-10-28
- Decision: Each tool call reads the discovery file and opens a fresh connection.
- Why: Agents often start the MCP server before `lightpath dev` is running, or keep it running across restarts.
- How: `connect` and `withClient` in `packages/mcp/src/server.ts`.

### D-039 Reuse eight decoration types in VS Code

- Date: 2026-10-28
- Decision: Create one decoration type per heat level once, and update each with one `setDecorations` call.
- Why: Creating a decoration type per line is slow and leaks.
- How: `Heat` in `extensions/vscode/src/decorations.ts`; `bucketize` in `src/heat.ts`. Highlights fade after `lightpath.fadeSeconds` (default 10) and can be pinned.

### D-040 Activate the extension when Lightpath is running

- Date: 2026-10-28
- Decision: Activate on `workspaceContains:.lightpath/daemon.json` and retry the connection every 2 s.
- Why: Zero setup, and nothing runs in workspaces that don't use Lightpath.
- How: `activationEvents` in `extensions/vscode/package.json`; `connect` and `scheduleRetry` in `src/extension.ts`.

### D-041 The CLI feeds the browser collector straight into the correlator

- Date: 2026-10-28
- Decision: `lightpath dev` runs the daemon and the browser collector in one process and passes messages directly.
- Why: No reason to serialize to HTTP inside one process.
- How: `ingestLocal` in `packages/cli/src/dev.ts`.

### D-042 Find the app URL in the dev command's output

- Date: 2026-10-28
- Decision: Open the first local URL the command prints, unless `--url` is given.
- Why: Users shouldn't have to repeat their port. ANSI colors and chunk splits are handled.
- How: `UrlWatcher` and `findLocalUrl` in `packages/cli/src/detect.ts`.

### D-043 Quote the command for the Windows shell

- Date: 2026-10-28
- Decision: On Windows, join the command into one quoted string for `shell: true`; elsewhere, pass an argument array without a shell.
- Why: Windows needs a shell to find `npm` and other `.cmd` shims. Measured: Node 24 warns (DEP0190) when an argument array is used with `shell: true`.
- How: `toShellCommand` in `packages/cli/src/env.ts`.

---

## 9. Python agent (`agents/python`)

### D-044 Use `sys.monitoring` with `DISABLE` and `restart_events()`

- Date: 2026-10-28
- Decision: The line callback records a hit and always returns `DISABLE`; each request starts with `restart_events()`.
- Why: Measured: each line costs one callback per request, and lines come in the order they first ran. Idle code costs nothing.
- How: `Recorder` in `src/lightpath_agent/recorder.py`. Python lines report a count of 1 because counts aren't available this way.
- Rejected: `sys.settrace` (much slower), and recording every hit (overhead).

### D-045 Claim tool ID 3 or 4

- Date: 2026-10-28
- Decision: Use the first free of `sys.monitoring` tool IDs 3 and 4.
- Why: IDs 0 to 2 are for debuggers, coverage tools, and profilers, so users can still run those.
- How: `Recorder.start`. Caveat: `restart_events()` is global and re-arms other tools' events too (documented in the README).

### D-046 Standard library only, with a background sender

- Date: 2026-10-28
- Decision: No dependencies; send with `urllib` from a daemon thread with a bounded queue.
- Why: Nothing to install into the user's environment, and requests are never delayed by sending.
- How: `transport.py`. Old messages are dropped when the queue is full.

### D-047 Finish a WSGI request when the server closes the body

- Date: 2026-10-28
- Decision: The WSGI middleware stops recording in the body's `close()`, not when the app returns.
- Why: A WSGI body can be a generator that runs more code while it's sent.
- How: `_ClosingIterable` in `wsgi.py`.

---

## 10. Libraries and why each one is here

| Library                                              | Version       | Used in         | Why we added it                                                                                                                             | Rejected alternatives                                                                                                 |
| ---------------------------------------------------- | ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `zod`                                                | 4.6.7         | protocol, mcp   | Validates every message at trust boundaries and gives TypeScript types from the same schema. The MCP SDK accepts zod shapes for tool inputs | Hand-written guards (types and checks drift apart), `zod/mini` (measured: only 26 KB smaller in the extension bundle) |
| `@jridgewell/trace-mapping`                          | 0.3.31        | core            | Fast, maintained source map reader used by Vite, Vitest, and c8. `eachMapping` makes D-010 simple                                           | `source-map` (slower, async API)                                                                                      |
| `ws`                                                 | 8.22.0        | daemon          | WebSocket server for clients, with `noServer` mode so auth runs before the upgrade and a payload cap                                        | Node has a WebSocket client but no server                                                                             |
| `playwright-core`                                    | 1.64.1        | browser         | Launches the installed Chrome or Edge with `channel`, gives a CDP session, init scripts, and request routing                                | `puppeteer` (no Edge channel, separate download), `playwright` (bundles browser downloads we don't need)              |
| `@modelcontextprotocol/sdk`                          | 1.32.2        | mcp; cli tests  | The official MCP implementation: `McpServer.registerTool` and a stdio transport; its client drives the integration test                     | Implementing JSON-RPC by hand                                                                                         |
| `cac`                                                | 7.1.0         | cli             | Small CLI parser that supports `--` for passing the user's command through                                                                  | `commander` (larger), `yargs` (much larger)                                                                           |
| `picocolors`                                         | 1.1.1         | cli             | Tiny terminal colors; respects `NO_COLOR`                                                                                                   | `chalk` (larger)                                                                                                      |
| `typescript`                                         | 7.0.2         | all             | `tsc -b` with project references builds packages in order, incrementally. We only use `tsc`, so the Go-based compiler doesn't break plugins | 6.0.3 kept as a fallback                                                                                              |
| `@types/node`                                        | 22.20.5       | all             | Pinned to the oldest supported Node so code can't use newer APIs by accident                                                                | 26.x                                                                                                                  |
| `vitest`                                             | 5.0.5         | all TS packages | Runs TypeScript and ES modules with no config, fake timers for the settle tests                                                             | Jest (needs ESM setup), `node:test` (weaker mocking and watch)                                                        |
| `@biomejs/biome`                                     | 2.6.3         | root            | One fast tool for linting and formatting                                                                                                    | ESLint + Prettier                                                                                                     |
| `esbuild`                                            | 0.28.2        | vscode          | Bundles the extension into one CommonJS file in about 40 ms                                                                                 | webpack                                                                                                               |
| `@vscode/vsce`                                       | 4.1.0         | vscode          | Official packager for `.vsix` files                                                                                                         | —                                                                                                                     |
| `@types/vscode`                                      | 1.100.0       | vscode          | Types for the minimum supported VS Code; `engines.vscode` matches                                                                           | Newest types (would allow APIs older VS Code lacks)                                                                   |
| `@types/ws`                                          | 8.18.2        | daemon          | Types for `ws`                                                                                                                              | —                                                                                                                     |
| `express`                                            | 5.3.0         | example         | The most common Node framework, so the demo is familiar                                                                                     | —                                                                                                                     |
| `react`, `react-dom`                                 | 19.3.1        | example         | The most common frontend, so the demo is familiar                                                                                           | —                                                                                                                     |
| `vite`, `@vitejs/plugin-react`                       | 8.3.5, 6.1.2  | example         | Most common dev server; measured: serves inline source maps that map `.tsx` correctly                                                       | —                                                                                                                     |
| `@types/express`, `@types/react`, `@types/react-dom` | 5.0.6, 19.3.0 | example         | Type checking the example                                                                                                                   | —                                                                                                                     |
| `hatchling`                                          | build only    | Python          | Simple, standard build backend for `pyproject.toml`                                                                                         | setuptools (more config)                                                                                              |

The Node agent and the Python agent have no runtime dependencies on purpose (D-014, D-046).

---

## 11. Tooling and repository

### D-048 pnpm workspaces through corepack ([ADR 0005](docs/adr/0005-tooling.md))

- Date: 2026-10-28
- Decision: pnpm 12.16.1, pinned in `packageManager`, run through corepack.
- Why: Strict dependency isolation catches packages that use a dependency they didn't declare.
- How: `pnpm-workspace.yaml` covers `packages/*`, `extensions/*`, and `examples/*`. Run `corepack enable` once so scripts can call `pnpm`.

### D-049 Allow only two dependency build scripts

- Date: 2026-10-28
- Decision: Allow install scripts for `esbuild` and `@vscode/vsce-sign` only, and exempt `@vscode/vsce` 4.1.0 from pnpm's minimum release age.
- Why: pnpm 12 blocks install scripts by default; these two need theirs. vsce 4.1.0 was only days old when added.
- How: `allowBuilds` and `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, written by `pnpm approve-builds`. Remove the exemption once the release ages.

### D-050 Strict TypeScript that Node can run directly

- Date: 2026-10-28
- Decision: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`.
- Why: `erasableSyntaxOnly` keeps code compatible with Node's type stripping, so the example server runs `.ts` files with no build and no source maps.
- How: `tsconfig.base.json`. This is why classes use explicit `#private` fields instead of constructor parameter properties.

### D-051 A type-check-only tsconfig in every test folder

- Date: 2026-10-28
- Decision: Each package has `test/tsconfig.json` (no emit) and a `typecheck` script that runs `tsc -p test`.
- Why: Vitest's transformer failed to load tests without a tsconfig it could find nearby (measured). Tests also deserve type checking.
- How: `pnpm typecheck` runs `tsc -b`, then every package's `typecheck`.

### D-052 Biome's `preset` instead of `recommended`

- Date: 2026-10-28
- Decision: Use `"preset": "recommended"` in `biome.json`.
- Why: Biome 2.6 deprecated `recommended: true`.

### D-053 LF line endings everywhere

- Date: 2026-10-28
- Decision: `.gitattributes` forces LF.
- Why: Byte offsets in fixtures and tests must match on Windows checkouts.

### D-054 Keep personal research notes out of git

- Date: 2026-10-28
- Decision: `project-ideas-research.md` is ignored.
- Why: It's personal planning, not part of the product.

### D-055 Split the first commit into 35 small commits

- Date: 2026-10-28
- Decision: Rebuild the history so each commit is one understandable step.
- Why: Readers of a public repo should be able to follow how it's put together.
- How: Grouped by package in dependency order; verified the final tree was identical to the single commit before pushing.

---

## 12. Testing

### D-056 Test the mapping against real V8 output

- Date: 2026-10-28
- Decision: Core tests run code under the inspector and check the resulting lines, instead of hand-writing coverage ranges.
- Why: If V8 changes its output shape, tests fail instead of the product silently lighting wrong lines.
- How: `captureCoverage` in `packages/core/test/helpers/capture.ts`.

### D-057 Real-browser tests are opt-in; the end-to-end test is the release gate

- Date: 2026-10-28
- Decision: Browser tests run only with `LIGHTPATH_BROWSER_TESTS=1`; `pnpm e2e` runs the shop under Lightpath and checks exact lines.
- Why: Launching a browser is slow and needs Chrome. The end-to-end test proves the demo actually works.
- How: `describe.skipIf` in `packages/browser/test/collector.integration.test.ts`; `scripts/e2e-shop.mjs`; both run in a separate CI job.

### D-058 Tests click like a person

- Date: 2026-10-28
- Decision: Tests press the mouse, hold 80 ms, and release.
- Why: Instant synthetic clicks lose the click event during the boundary pause (D-026). `page.click()` also adds Playwright's own listener.

### D-059 Python tests use `unittest` and line markers

- Date: 2026-10-28
- Decision: Use the standard `unittest` runner, and find expected lines with `# mark: name` comments.
- Why: No test dependencies; editing the fixture doesn't break hard-coded line numbers.
- How: `agents/python/tests/fixture_app.py` and its `line_of()` helper.

---

## 13. Example app (`examples/shop`)

### D-060 Run the example API as TypeScript with no build

- Date: 2026-10-28
- Decision: The Express server is `.ts` run directly by Node's type stripping.
- Why: It shows Lightpath on TypeScript with no source maps involved, the simplest path.
- How: `dev.mjs` passes `--experimental-strip-types` on Node 22 releases before 22.18, where stripping wasn't on by default.

### D-061 The API prints no URL

- Date: 2026-10-28
- Decision: The API logs only its port.
- Why: `lightpath dev` opens the first local URL it sees (D-042), which must be Vite's.

### D-062 Resolve Vite's binary through its `package.json`

- Date: 2026-10-28
- Decision: Read the `bin` field instead of resolving `vite/bin/vite.js`.
- Why: Measured: Vite 8's `exports` map hides that path (`ERR_PACKAGE_PATH_NOT_EXPORTED`).

### D-063 Give the shop branches worth seeing

- Date: 2026-10-28
- Decision: Orders have empty-cart, unknown-product, out-of-stock, and declined-payment paths; pricing has a loop, a coupon, and a free-shipping threshold.
- Why: The demo should show dark lines next to lit ones, and loops with high hit counts.

---

## 14. Process

### D-064 Keep this log

- Date: 2026-10-28
- Decision: Every meaningful decision during a code change gets an entry here; big ones also get an ADR.
- Why: Future contributors, and interviewers, should be able to see why the code is the way it is.
- How: This file, plus the rule in CONTRIBUTING.md.
