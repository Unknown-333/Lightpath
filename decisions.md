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

### D-003 Publish under the `@lightpath-dev` npm scope and as `lightpath-agent` on PyPI

- Date: 2026-10-28, revised 2026-10-29
- Decision: npm packages are `@lightpath-dev/*` with `@lightpath-dev/cli` providing the `lightpath` command; the Python package is `lightpath-agent`.
- Why: The bare name `lightpath` is taken on npm (a browser HTTP wrapper) and on PyPI. The plan was the `@lightpath` scope, but on 2026-10-29 npm reported the organization name `lightpath` as not available, even though no `@lightpath/*` packages exist. The `lightpath-dev` organization was created instead; the same name also works for a GitHub organization and social handles.
- How: Package names in each `package.json`, every import, the docs, and `agents/python/pyproject.toml`. The command people type is still `lightpath`.
- Rejected: Renaming the project (only package names were taken); `@lightpathjs` and `@getlightpath` (also free, but less readable).

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
- How: `node:inspector`, `node:diagnostics_channel`, and the global `fetch`. `@lightpath-dev/protocol` is a dev dependency used for types only.
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
- Revised by D-086: loopback origins on any port are tagged too; the preflight concern turned out not to apply to headers added by interception.

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
- Decision: `DaemonClient` lives in `@lightpath-dev/protocol` and uses the global `WebSocket`.
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

### D-065 Claim lightpath-agent on PyPI with a real 0.0.1 release

- Date: 2026-10-29
- Decision: Publish the working Python agent as `0.0.1` (pre-alpha) to claim the name, instead of an empty placeholder.
- Why: PyPI has no way to reserve a name; the first upload claims it. PyPI removes packages that exist only to hold a name.
- How: Version set in `agents/python/pyproject.toml` and `__version__`; added keywords and `[project.urls]`; the README now links to GitHub with an absolute URL so it works on PyPI. Built with `python -m build`, checked with `twine check`, and installed into a clean virtual environment before uploading. The upload uses an account-wide token once; afterwards it's replaced with a token scoped to the `lightpath-agent` project.
- Rejected: An empty placeholder package.

### D-066 VS Code publisher ID is lightpath-dev

- Date: 2026-10-29
- Decision: Publish the extension under the Marketplace publisher `lightpath-dev` (display name "Lightpath"), so its ID is `lightpath-dev.lightpath-vscode`.
- Why: Matches the npm organization (D-003), so the project has one name across registries. The publisher was created on 2026-10-29.
- How: `publisher` in `extensions/vscode/package.json`; also added `repository`, `bugs`, and `homepage`, which `vsce` warns about when missing and the Marketplace shows on the extension page.
- Rejected: `lightpath` (keeps names inconsistent across registries).

### D-067 Biome skips pnpm-lock.yaml

- Date: 2026-10-29
- Decision: Exclude `pnpm-lock.yaml` from Biome and keep it in the format pnpm writes.
- Why: Biome formatted the lockfile once (double quotes), and every later `pnpm add` rewrote it back to single quotes. One new dependency showed up as a 3,309-line diff, which hides the real change in review. The lockfile is generated, so its owner (pnpm) decides the format.
- How: Added `!pnpm-lock.yaml` to `files.includes` in `biome.json` and let pnpm rewrite the file. Checked that both versions resolve the same 372 packages and that `pnpm install --frozen-lockfile` passes.

### D-068 Treat Windows absolute paths in source map sources as file URLs

- Date: 2026-10-29
- Decision: Before handing a source map to trace-mapping, rewrite `sources` entries (and `sourceRoot`) that look like `C:\...` or `C:/...` as `file:///C:/...` URLs.
- Why: The tsx fixture showed that tsx on Windows writes `sources: ["C:\\Users\\...\\a.ts"]`. trace-mapping treats that as a relative path and appends it to the map URL, giving `file:///C:/.../samples/C:\Users\...` and a file that resolves nowhere. Every line of a tsx-loaded file was lost. POSIX paths and URLs already resolve correctly, so only the Windows form needs help.
- How: `withWindowsSourcesAsUrls` in `packages/core/src/sourcemap.ts` returns the map unchanged unless a Windows path is present. Spaces, `#`, `?`, and `%` are percent-encoded so URL parsing keeps them. Unit tests cover backslashes with a space, forward slashes, a Windows `sourceRoot`, and a POSIX path.

### D-069 Core fixtures are captured from real V8 runs and checked by hand

- Date: 2026-10-29
- Decision: Keep sample programs in `packages/core/test/fixtures/samples/`, capture their real V8 coverage with `packages/core/scripts/capture-fixtures.mjs`, and write the expected lines by hand in `test/fixtures.test.ts`. Add `tsx` 4.23.15 as a dev dependency of core, used only by the capture script.
- Why: Hand-built ranges only test what we already believe about V8. Real captures caught a bug on the first run (D-068). Expected lines are written by hand, not generated, so a re-capture that changes behavior fails the test instead of quietly updating it. tsx is the most common way to run TypeScript that type stripping can't handle (enums, parameter properties), and it's the loader the roadmap names for M1 and M2. Its only dependency is esbuild, which we already have.
- How: Each sample runs in its own child process (so one sample's compiled functions don't affect another's) with the agent's take, act, take pattern. Machine paths become `file:///repo/samples`, so fixtures are the same on every OS (`.gitattributes` already forces LF). Each fixture stores the sample's SHA-256, and a test fails if the sample changed without a re-capture. Fixture JSON is excluded from Biome because it's generated. The samples are excluded from the test type check because `tsx-transform.ts` uses an enum and parameter properties on purpose.

### D-070 The Vite JSX fixture is the shop's real Cart.tsx, captured in Chrome

- Date: 2026-10-29
- Decision: Capture the Vite fixture from `examples/shop/src/Cart.tsx` during one real Checkout click in Chrome, instead of writing a separate sample. The capture reuses `playwright-core` from the browser package and the shop's own Vite setup.
- Why: The shop is what the demo and the e2e test use, so its React transform output (HMR preamble, `jsxDEV` calls, StrictMode double renders) is exactly what users will see first. A second Vite project just for one fixture would add setup and drift from it. Borrowing `playwright-core` keeps core's dependencies unchanged.
- How: `captureViteJsx()` in `packages/core/scripts/capture-fixtures.mjs` runs the shop without Lightpath, takes coverage around the click over CDP, and saves the served source and inline map. Vite's React transform writes the absolute path into the code (`_jsxFileName`), so `redactSameLength()` replaces it with a placeholder of the same length; changing the length would shift every offset after it. The fixture stores the SHA-256 of `Cart.tsx`, so editing the shop's cart makes the core test fail with a pointer to re-capture. That coupling is on purpose: the expected lines describe that file.

### D-071 The extension requires VS Code 1.101 or newer

- Date: 2026-10-29
- Decision: Raise `engines.vscode` from `^1.100.0` to `^1.101.0` and `@types/vscode` to 1.101.0 to match.
- Why: The in-editor test (D-072) failed on VS Code 1.100.0: the extension never connected. VS Code 1.100 runs extensions on Node 20.19, which has no global `WebSocket`, and `DaemonClient` uses the global one. VS Code 1.101 is the first on Node 22 (22.15.1), where it exists. The test passes on 1.101.0 and on 1.144.0 (current stable, Node 24.22). This replaces the `@types/vscode` 1.100.0 choice in the dependency table above.
- How: Probed each downloaded VS Code with `ELECTRON_RUN_AS_NODE=1` for `process.versions.node` and `typeof WebSocket`. Bundling the `ws` package instead would keep 1.100 working, but it adds a dependency for one VS Code release from mid-2025, so raising the minimum is simpler.

### D-072 Test the extension inside a real VS Code with @vscode/test-electron

- Date: 2026-10-29
- Decision: Add `pnpm test:vscode`. It runs the shop under Lightpath, starts a downloaded VS Code with the extension, clicks Checkout, and checks the highlights from inside the editor. Add `@vscode/test-electron` 3.1.0 as an extension dev dependency, and have `activate()` return a small read-only API (`isConnected`, `traceIds`, `drawnLines`).
- Why: The extension had never run in an editor, and the unit tests only cover the pure helpers in `heat.ts`. VS Code has no API to read decorations back, so `Heat` records what it drew and the API exposes it. Returning an API from `activate()` is VS Code's standard way for an extension to expose itself, and it doesn't change behavior. `@vscode/test-electron` is Microsoft's tool for this; it downloads a separate VS Code, so the test doesn't depend on, or disturb, the one installed. It found D-071 on its first run against the minimum version.
- How: `extensions/vscode/test/editor/run.mjs` reuses the e2e setup, then calls `runTests()` with a temp `--user-data-dir` and `--extensions-dir` and `--disable-extensions`. The suite (`suite.cjs`, plain CommonJS so any supported VS Code loads it without a build) asks the runner to click through `POST /click` once its editors are open, so the trace arrives live. It checks that the drawn lines and heat levels equal the trace for `Cart.tsx` and `orders.ts`, then runs Clear Highlights. `LIGHTPATH_VSCODE_VERSION` picks the version (default stable). Not in CI yet: Linux needs a virtual display, and each run downloads about 150 MB.

### D-073 Backend e2e through the real CLI, with tsx compared against type stripping

- Date: 2026-10-29
- Decision: Add `scripts/e2e-api.mjs` (`pnpm e2e:api`). It runs the shop's Express API through `lightpath dev --no-browser` three ways (type stripping, `tsx`, `tsx watch`), posts an order, and requires both tsx runs to light exactly the lines type stripping lights. Add `tsx` 4.23.15 as a shop dev dependency, and run the e2e in CI on Ubuntu, macOS, and Windows with Node 22 and 24.
- Why: M2's exit check is a backend request showing up in the terminal, and the most common way people run a TypeScript API in development is `tsx` (often `tsx watch`). Reusing the shop's server means no second app to maintain, and type stripping gives a free reference: it keeps every offset and needs no source map, so any difference in a tsx run is a mapping bug. Running the real CLI (not the packages directly, like `e2e-shop.mjs`) also covers argument parsing, `NODE_OPTIONS`, the skip rule for tsx's CLI, and the terminal output. It needs no browser, so it can run on all three OSes; path handling is the part most likely to differ between them (D-068 was Windows-only).
- How: The script finds the daemon through the discovery file the CLI writes, and reads traces over the client WebSocket like the extension does. Run against the build from before D-068, it fails: the tsx run never produces a trace with `orders.ts`. Processes are stopped as a tree (`taskkill /T` on Windows, a process group on POSIX), and the script waits for port 3001 to be free before the next run.

### D-074 The agent sizes ingest batches by bytes, and drops what can never be accepted

- Date: 2026-10-29
- Decision: The Node agent's transport now builds each POST from the head of its queue until it reaches 200 messages or 7 MB (`MAX_BODY_BYTES`), drops a single message that is larger than that on its own, and treats a 413 from the daemon like a 400: drop the batch and move on.
- Why: Forwarding external source maps (D-076) makes `scripts` messages much larger. The old transport sent up to 200 messages in one body regardless of size; past the daemon's 8 MB limit the daemon answered 413, the transport kept the batch and retried it forever, and every later message (deltas included) waited behind it. One large app could silently stop all tracing.
- How: `#nextBatch()` serializes each message once and joins the body from the parts, so the size check costs nothing extra. Messages leave the queue only after a successful or final answer, so a network failure still keeps them for the retry. The agent can't import the protocol package (ADR 0002), so `test/transport.test.ts` checks `MAX_BODY_BYTES` stays below `MAX_MESSAGE_BYTES` with room for the envelope, and covers splitting, the oversized drop, the 413 drop, and keeping messages when the daemon is down.

### D-075 A source map mapping counts only if code starts in its span

- Date: 2026-10-29
- Decision: In `mapToOriginal`, each mapping covers the generated text up to the next mapping on the same line (or the line's end). It contributes only if a non-whitespace character starts in that span, and its count is read at that character.
- Why: Running the shop API built by `tsc` lit four lines that type stripping leaves dark in `orders.ts` (17, 24, 28, 36), plus one each in `payment.ts` and `pricing.ts`. All were the `}` of a block that didn't run. tsc writes two mappings per `}`: one on it and one just after it. V8 counts the brace as part of the untaken block (0) and the position after it as the enclosing code (1), and the old rule took the maximum per line. A mapping over nothing but the end of a line marks no code that could run.
- How: Mappings are visited in generated order, and each is credited when the next one arrives. `LineIndex` keeps the source and gains `codeStart(from, to)`. All five M1 fixtures (tsx and Vite maps included) give the same lines as before, and the tsc run now matches type stripping in every file. A unit test reproduces tsc's two-mapping pattern.

### D-076 The Node agent reads external .map files and forwards them inline

- Date: 2026-10-29
- Decision: When a script's `sourceMapURL` isn't a `data:` URL, the agent reads the file once per script hash and sends it as a `data:` URL with absolute `sources`. Only `file:` maps of `file:` scripts, only inside the workspace roots, at most 3 MB, and only valid version 3 maps. The daemon still never reads files.
- Why: `tsc` output (`dist/*.js` next to `*.js.map`) is the most common way to run a compiled Node backend, and without the map Lightpath showed `dist/` JavaScript instead of the TypeScript the user edits. The agent is the right place: it runs on the same machine as the files and already knows the workspace roots, so the protocol's rule (maps travel inline, ADR 0006) stays as it was. The map path comes from a comment in the app's own files, so it's treated as untrusted. Without the workspace check, a `//# sourceMappingURL=` comment could make the agent send any file the user can read; `URL` resolution removes `..` before the check.
- How: `readExternalSourceMap` in `packages/node-agent/src/sourcemap-file.ts`, called from `#pushSources`; `sources` and `sourceRoot` are resolved against the map's own location, so maps in another folder still resolve. `pnpm e2e:api` gained a fourth run: the shop API built by `tsc -p tsconfig.server.json` and run as `node dist/server/index.js`; it must light exactly the lines type stripping does, and no `dist/` file may appear. Symlinks inside the workspace that point outside it aren't detected (`URL` doesn't resolve them); that's noted as a limit.

### D-077 Fastify and NestJS examples in examples/backends, tested end to end

- Date: 2026-10-29
- Decision: Add `examples/backends`: one shared checkout module, served by a Fastify 5.12.7 app run with type stripping and a NestJS 12.3.2 app (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, plus `reflect-metadata` 0.2.2 and `rxjs` 7.8.2, which Nest requires) built by tsc. `pnpm e2e:api` runs both and requires Nest's lines in the shared file to equal Fastify's.
- Why: Fastify and Nest are the two most used Node frameworks after Express, and Nest stresses the parts most likely to break: legacy decorators and `emitDecoratorMetadata` (so it can't run with type stripping or tsx), a tsc build with `.map` files, and an ESM framework (Nest 12 ships as ES modules). One shared module gives a reference that doesn't depend on either framework. Lightpath itself needed no change: both frameworks serve through `node:http`, which publishes the `diagnostics_channel` events the agent brackets requests with.
- How: The example turns `erasableSyntaxOnly` off and decorators on in its own tsconfig; `tsconfig.nest.json` emits to `dist/`. Biome needs `unsafeParameterDecoratorsEnabled` for `@Body()`, and `useImportType` is off for the Nest folder, because Biome's fix turned the injected service into `import type`, which erases the class from the decorator metadata and breaks Nest's injector at startup (seen in the first run). Nest's logger is off, so `main.ts` prints startup errors itself. The e2e script became a table of runs (app folder, command, body, files, dark and lit lines found by their text, reference run), and stopping a process tree that already exited no longer hides the real error.

### D-078 Benchmark the Node agent's per-request cost, and time reads in debug mode

- Date: 2026-10-29
- Decision: Add `bench/node-requests.mjs` and `bench/README.md` with measured results. With `LIGHTPATH_DEBUG=1`, the agent logs each coverage read's duration and function count (`InspectorSession` takes an optional observer). The README's "runs slower" limit now states the numbers.
- Why: The roadmap's open question, and the honest answer users need before trying it on a big backend. Generated apps make the size a controlled variable (1,000, 10,000, and 50,000 functions); the three example apps show real frameworks. Timing inside the agent measures the read itself rather than guessing from request latency. Without debug, the observer is absent and `take()` does no extra work.
- How: Results on Node 24.13, Windows, Ryzen 7 9700X: a read costs about 0.45 ms per 1,000 compiled functions (`node_modules` included), two reads per request. Express, Fastify, and Nest examples have 4,400 to 8,600 functions and pay 4 to 6 ms per request; a 50,000-function app pays about 50 ms. The cost is almost all the reads, so a future option could skip the start-of-request read when no other request is in flight; not done now, because that read is what keeps background work out of the request's trace.

### D-079 Enter and Space are action boundaries too

- Date: 2026-10-29
- Decision: The browser hook also pauses on a capture `keydown` for Enter (except in a textarea or contenteditable) and Space (only on buttons, links, inputs that aren't text fields, `summary`, and ARIA widgets). Held keys, IME composition, and Ctrl, Alt, or Meta shortcuts are ignored. Trace labels get the key: `button: Checkout (Enter)`.
- Why: Keyboard users, and anyone submitting a form with Enter, got no trace at all. The rules follow what actually activates an element in the browser, so typing never opens a trace (a test types "two words" into a field and expects none). A pause doesn't lose key events the way it loses pointer releases: in a spike, Enter and Space still activated a button, link, form field, checkbox, and `role="button"` element after a 70 ms pause.
- How: Same `debugger;` pause and `#click` path as pointer presses; the listeners are now named functions so the collector can tell them apart (D-080). Real-browser tests: Enter on a button (trace includes `checkout` and a tagged request), Enter in a form field (`applyCoupon` only), and typing (no trace). ADR 0003 updated.

### D-080 Keep full-page navigations in the action's trace

- Date: 2026-10-29
- Decision: The hook adds a capture `beforeunload` listener that pauses once more; the collector takes coverage there and files it under the active trace (or as background). Main-frame navigation requests to a backend origin get the trace header.
- Why: Clicking a link or posting a form replaced the document, and the leaving page's coverage (the click handler itself) went with it: the spike's trace held only the next page's code. `beforeunload` runs while the old document still exists, so its coverage and sources can still be read. The first attempt took coverage from the request interception handler for the navigation; that deadlocks, because the renderer is waiting on the request the handler is holding (`takePreciseCoverage` timed out after 3 s). Navigations aren't subject to CORS, so tagging them can't cause a preflight, and a server-rendered page or form post is the action's backend work.
- How: `#onPaused` routes by the paused function's name (`lightpathAction` or `lightpathLeave`). The listener never sets `returnValue`, so no "leave site?" prompt. A real-browser test clicks a link to a second page and checks one trace contains the old page's `leaving` handler, the new page's `arrived`, and a tagged page request. Keyboard and navigation share the hook and the pause routing, so they're one commit.

### D-081 Read coverage right after each page load

- Date: 2026-10-29
- Decision: The collector takes coverage on the page's `load` event (queued with actions, skipped while one is open) and files it as background, then takes once more to time a steady read.
- Why: The first click paid for reading everything the page load ran: 40 ms at 12,000 functions against 8 ms for later clicks, so the first click was the one most likely to exceed the press budget. The second read is the best predictor of what every click will cost, so the boundary (D-082) can be decided before the first click.
- How: `#afterLoad` in `packages/browser/src/collector.ts`. First pause at 3,000 components dropped from 40.6 ms to 5 to 11 ms.
### D-082 Move the click boundary to the mouse release when reads are slow

- Date: 2026-10-29
- Decision: If a coverage read at the press takes over 20 ms (`PRESS_BUDGET_MS`, configurable as `pressBudgetMs`), the hook pauses at `pointerup` instead of `pointerdown` from then on, including after reloads. The CLI prints a notice when this happens.
- Why: `bench/browser-pause.mjs` showed pauses of 66 ms p50 at 6,000 React components (24,600 functions, Vite dev). Sending a press and release without waiting for each to be acknowledged, like a real mouse, delivered 0 of 8 clicks for presses of 10 to 50 ms at that size: Chrome drops a release that arrives while the page is paused at the press (ADR 0003). A pause at the release loses nothing: mouseup and click still arrived after 200 ms (measured), and all short presses worked at 6,000 components with this change. Making the read faster isn't possible from outside V8, and a non-blocking read (a binding) lands the handler in the wrong window (ADR 0003's first attempt).
- How: The hook notes the press and pauses at the next primary `pointerup` when `window.__lightpathRelease` is set; the collector sets it with `Runtime.evaluate` and an init script for later documents. Only pointer presses count toward the budget; key presses don't drop events. Trade-off, stated in the notice and bench/README.md: `pointerdown` and `mousedown` handlers run before the boundary, so they're not in the click's trace. A real-browser test forces the release boundary with `pressBudgetMs: 0` and a 10 ms press.

### D-083 Mark files touched only by periodic code as background

- Date: 2026-10-29
- Decision: The daemon counts, per collector, how many background deltas each function ran in. A function seen in 3 or more is periodic. A trace file whose lit lines all come from periodic functions gets `background: true`. No lines are removed. The CLI lists such files last and dimmed, the extension doesn't light them (unless opened from the Actions view), and MCP output labels them.
- Why: A timer, a poll, or an animation loop that fires during a click's settle window shows up in that click's trace and buries the real answer. Background deltas were already collected and thrown away (ARCHITECTURE 4.6 rule 2 was planned, not built). Tagging instead of dropping keeps the trace honest: if the user's question is about the timer, the lines are still there. Three windows, not two: code that ran once at page load and once more by chance shouldn't qualify. Per-file rather than per-line, because the extension and CLI work per file, and a file with the clicked handler in it must stay foreground even if a timer also runs there.
- How: `PeriodicFunctions` in `packages/core/src/noise.ts` (keyed by script hash and start offset, so hot reloads reset it; capped at 50,000 entries, least recently seen dropped first). The correlator maps the action twice only when it contains periodic functions. Checked in Chrome with a 50 ms `setInterval`: from the third click on, `clock.js` was background and the clicked `save.js` wasn't. Python agents send lines, not functions, so their files are always foreground.

### D-084 Rewrite Windows absolute map sources to file URLs without reading the host OS

- Date: 2026-10-29
- Decision: In `readExternalSourceMap`'s `toUrl`, build the `file:` URL for a Windows absolute source (`C:\...`) by hand instead of with `pathToFileURL`.
- Why: CI went red on Linux and macOS from commit `7480de9` on (the D-076 external-map work), while Windows stayed green. The test "turns Windows absolute sources into file URLs" expected `file:///C:/repo/src/c.ts` but on a non-Windows runner got `file:///…/node-agent/C:%5Crepo%5Csrc%5Cc.ts`. `pathToFileURL` reads the host OS: on POSIX it treats `C:\repo\src\c.ts` as a relative name, resolves it against the CWD, and percent-encodes the backslashes. But a source map carries the app author's machine paths regardless of where the agent or the daemon runs, so a Windows path in `sources` must map the same way on every OS.
- How: `toUrl` splits the value on either slash, keeps the drive letter, `encodeURIComponent`s each segment, and parses `file:///<drive>/<segments>` with `new URL`. It uses only `String.split`, `encodeURIComponent`, and the WHATWG `URL` constructor, none of which read the host OS, so the result is identical on Windows, Linux, and macOS. The now-unused `pathToFileURL` import was removed. `pnpm check` passes locally; the node-agent suite is 31/31.
- Rejected: Guarding the test with `process.platform === 'win32'` (hides a real cross-platform bug rather than fixing it); keeping `pathToFileURL` and normalizing its output afterward (more fragile than building the URL directly).

### D-085 Preload the Node agent with --require instead of --import

- Date: 2026-10-29
- Decision: `lightpath dev` adds `--require="<path of register.js>"` to `NODE_OPTIONS` (`withRequire()` in `packages/cli/src/env.ts`), with forward slashes in the path. The agent stays an ES module.
- Why: The first real app tried (stepful/fullstack_boilerplate, a Fastify API run by `nodemon --exec ts-node`) crashed at startup under Lightpath with `ERR_MODULE_NOT_FOUND` for `./db-client`, and ran fine without it. An empty file passed with `--import` crashed it the same way, so the agent's code wasn't the cause: any `--import` makes Node run the main file through its ES module loader, which never calls `require` hooks, so ts-node's `.ts` hook was skipped. With `--require` the main file goes through `Module.runMain` as before, and ts-node works. Node 22.12+ can `require()` an ES module without top-level await, which the agent has none of; on 22.12 that prints one experimental warning, on 22.13 and later nothing (measured on 22.12.0, 22.13.0, 22.23.4, 24.0.0, 24.13.0). On Windows `NODE_OPTIONS` drops backslashes inside quotes (`C:\Users\…` became `C:Users…`, measured), so the path uses forward slashes, which Node accepts.
- How: A CLI test reproduces the ts-node case with no dependency: a `-r` hook registers `require.extensions['.tsx-like']` and the main file has that extension. Under the old flag it fails with `ERR_UNKNOWN_FILE_EXTENSION`; under the new one it runs and sees the agent loaded. ADR 0002, ARCHITECTURE 5.2, flow.md, and both READMEs updated. `pnpm e2e` and `pnpm e2e:api` (tsx, tsx watch, tsc, Fastify, Nest) still pass.
- Rejected: Detecting ts-node and switching flags only then (the same break hits any tool built on `require` hooks: `@babel/register`, `esbuild-register`, `@swc/register`); a CommonJS copy of the agent (a second build output to keep in sync, for no gain over Node's own `require()` of ES modules).

### D-086 Tag requests to any loopback origin, not only configured ones

- Date: 2026-10-29
- Decision: `shouldTag` also returns true for fetch, XHR, and navigation requests to `localhost`, `127.0.0.1`, or `[::1]` on any port. Remote origins still need `backendOrigins` (`--backend`).
- Why: The first real app's frontend (Vite on :3000) calls its Fastify API directly on :3001, a common setup. Out of the box every click's trace had the frontend files but no backend, and each API call showed up as its own backend-only trace; it took `--backend http://localhost:3001` to join them. D-029 kept the header off other origins because a custom header causes a CORS preflight. That holds for headers the page sets, not for one added by `page.route`: Chrome has done its CORS checks before interception, so no preflight is sent. Measured in a spike against an API whose CORS policy allowed no custom headers (GET and a JSON POST both reached it with the header, no extra OPTIONS), and now in a real-browser test whose API rejects every preflight with 405. Loopback is the dev machine itself, so the trace ID doesn't leave it.
- How: `LOOPBACK` set in `packages/browser/src/rules.ts`; unit cases for the three loopback forms, an image request (not tagged), `localhost.example.com`, and a LAN address (not tagged). The real-browser test adds a second server on another port. With the change, the stepful app's "Take quiz" trace has the React files and `backend/server.ts` lines 27-31 with no flags. ADR 0004 and ARCHITECTURE 3 and 6 updated; D-029 marked revised.
- Rejected: Making the Node agent report its listening ports so the CLI can add them (more moving parts, and it misses servers in processes the agent skips); telling users to pass `--backend` (the first-run experience is the product).

### D-087 Map webpack dev builds through webpack:// and webpack-internal:// module URLs

- Date: 2026-10-29
- Decision: `resolveFile` understands `webpack://<name>/./src/a.tsx?hash` and `webpack-internal:///./src/a.tsx`, resolving the module path against the dev server's root (webpack's `context`, which is the folder the dev command runs in), dropping webpack's runtime as internal and `node_modules` modules (loader chains included) as dependencies. The browser collector keeps those scripts instead of filtering every non-HTTP URL. A webpack module with no source map is dropped as `no-source-map`, never mapped by its own offsets, and the CLI says once how to turn maps on.
- Why: The second real app (chrisvel/tududi, React 18 + webpack 5 + swc-loader) showed no frontend files at all. Chrome reports each webpack module as its own script: 1,279 `webpack://tududi/./frontend/…` scripts with webpack's default dev `devtool` (`eval`, no maps), and `webpack-internal:///./frontend/…` with an inline map under `eval-cheap-module-source-map` (measured). The collector dropped all of them because they aren't `http(s)` URLs. With the default `eval`, the module code is swc's output, so its line numbers don't match the `.tsx` on disk; lighting them would be wrong, so the honest result is no file plus a notice. With maps on, the login click showed 46 frontend files.
- How: `webpackModulePath()` in `packages/core/src/resolve.ts`, checked before the generic `node_modules` rule so a loader chain like `css-loader!./src/a.css` resolves to the CSS file; `isNoiseScript` in `packages/browser/src/rules.ts` uses it; the pipeline drops unmapped webpack modules; the collector warns on the first unmapped app module ("Set devtool: 'eval-cheap-module-source-map'"). Unit tests for URL forms, runtime modules, loader chains, `..`, and the unmapped drop.
- Rejected: Patching the user's webpack config (Lightpath doesn't change user code); fetching `.map` files over HTTP (webpack's `eval-*` maps are already inline, and production-style `source-map` builds aren't the dev case).

### D-088 Skip webpack, nodemon, and concurrently processes in the Node agent

- Date: 2026-10-29
- Decision: Add `webpack`, `webpack-cli`, `webpack-dev-server`, `nodemon`, and `concurrently` (when run from `node_modules`) to the agent's tool skip list. `ts-node` stays instrumented.
- Why: In tududi, `webpack serve` loaded the agent, and its own config file showed up as backend code (`webpack.config.js` lines in many traces, including the dev server's static file responses, which became backend-only traces). The webpack dev server is a tool like Vite, which was already skipped. nodemon and concurrently only start other processes, so instrumenting them costs an inspector session and catches nothing. ts-node is different: it runs the app in its own process, so skipping it would lose the backend (D-085).
- How: `DEFAULT_SKIP` in `packages/node-agent/src/config.ts`; test cases for each tool and a ts-node command line that must stay instrumented.

### D-089 Block service workers in the browser Lightpath opens

- Date: 2026-10-29
- Decision: The collector creates its browser context with `serviceWorkers: 'block'`.
- Why: tududi registers a service worker that answers the app's `/api` fetches. Requests a worker sends come from its own context, so `page.route` didn't see them and couldn't add the trace header: clicking "Add" and saving a task produced a browser trace with no backend, and `POST /api/inbox` as a separate backend-only trace. The browser Lightpath opens is a dev profile thrown away on exit, so offline caching isn't something to keep there, and Playwright's own guidance is to block workers when routing requests.
- How: One option in `packages/browser/src/collector.ts`. A real-browser test serves a page that registers a pass-through worker, reloads so the worker would control it, and presses a button. With the option the registration is refused and the request carries the trace header. With `serviceWorkers: 'allow'` the page is controlled and the request reaches the server with no header (measured). Trade-off, for the README: an app whose behavior depends on its service worker (offline mode, push) behaves as if the browser had none while traced.

### D-090 Only a control's or a leaf element's text labels a click

- Date: 2026-10-29
- Decision: When the clicked element isn't inside a button, link, input, label, ARIA role, or `data-testid` element, the hook uses its text for the label only if it has no child elements and isn't `html`, `body`, `script`, or `style`.
- Why: A click on an empty area in tududi was labelled `html: (function () { function sanitize(value)…`: the target was the `html` element, whose `textContent` is the whole page, inline scripts included. A label should name what was clicked, and a container's text doesn't.
- How: `describe()` in `HOOK_SOURCE` (`packages/browser/src/collector.ts`). Such clicks are now labelled by tag alone (`html`, `div`).

### D-091 Hold a click's window open across a full-page navigation

- Date: 2026-10-29
- Decision: When the page pauses in `beforeunload` during an action, the collector counts the navigation as one request in flight until the next document's `load` event. If no `load` comes (a download, a cancelled leave), the count is cleared when the window ends.
- Why: The navigation test failed once on Linux CI (PR #2) with the new page's `arrived` missing from the trace, and passed on rerun. A link click makes no request until after the `beforeunload` pause, so the 300 ms quiet timer was already running while the collector read coverage there. On a slow machine it could fire in that gap, and the closing read then ran before the new page's scripts. Waiting for `load` makes the window cover the whole navigation.
- How: `#navigating` in `packages/browser/src/collector.ts`, set in `#onLeave`, cleared by the page's `load` listener or after `settled` in `#click`. The real-browser suite passed 3 runs in a row.

### D-092 Film the demo through DevTools screencasts, not the screen

- Date: 2026-10-29
- Decision: `extensions/vscode/scripts/record-demo.mjs` records the M4 demo from two `Page.startScreencast` streams: the shop in headless Chrome, and a separate VS Code started with `--remote-debugging-port` and reached with Playwright's `connectOverCDP`. Frames are resampled to one 12 fps timeline and put side by side with ffmpeg, then turned into `docs/media/demo.gif`.
- Why: Screen capture would film whatever else is on the screen, needs the windows placed and unobstructed, and works differently on each OS. A screencast sees only the page it's attached to, so the video is the same on any machine and nothing private ends up in it. Driving VS Code by its keyboard (Quick Open, the command palette) also shows a viewer the real commands.
- How: VS Code is the copy the in-editor test downloads, with a throwaway profile (dark theme, no minimap, no AI features, `lightpath.fadeSeconds: 0`). The headless page gets an injected pointer, since screencasts don't draw the mouse; it's injected with `evaluate`, so it has no script URL and the collector drops it. ffmpeg comes from `PATH` or `FFMPEG`, and isn't a dependency.
- Rejected: OS screen capture (ffmpeg `gdigrab`, `avfoundation`, `x11grab`); Playwright's `recordVideo` (Chrome side only, and its ffmpeg build writes only VP8 WebM).

### D-093 Run the in-editor test in CI

- Date: 2026-10-29
- Decision: A new `editor` CI job runs `pnpm test:vscode` on Ubuntu under `xvfb-run`, with the downloaded VS Code cached. The suite now also checks Replay: it opens every file of the Checkout trace in `replayOrder`, and the last one is lit with the trace's lines.
- Why: The extension was only tested by hand. The in-editor test is the only check that the decorations, the Actions view, and the commands work in a real VS Code, so it should run on every change. A reversed replay order now fails the test (measured).
- How: `.github/workflows/ci.yml` and `extensions/vscode/test/editor/suite.cjs`.

### D-094 `lightpath.config.json`, validated strictly, flags win

- Date: 2026-10-29
- Decision: `lightpath dev` and `lightpath doctor` read `lightpath.config.json` from the current folder (or `--config <file>`). Keys: `command`, `url`, `webRoot`, `backend`, `roots`, `ignore`, `settleMs`, `maxSettleMs`, `browser`, `headless`, and `$schema`. All optional. A flag on the command line wins over the file; `ignore` globs from both are combined. Unknown keys and bad values stop the CLI with every problem listed.
- Why: The trials needed the same flags on every run (D-086 still needs `--backend` for remote APIs), and generated code had no way out of traces. Typos in a config file that pass silently are worse than no file, so the schema is strict. A `command` key means a project can be started with plain `npx @lightpath-dev/cli dev`. Only the current folder is read, so a file never applies by surprise from a parent.
- How: `packages/cli/src/config.ts` (zod schema `LightpathConfig`, `loadConfig()`); paths in `webRoot` and `roots` resolve against the file's folder, `backend` entries become origins. `packages/cli/lightpath.config.schema.json` is the JSON Schema for editors, generated from the same zod schema; a test fails when they differ (`UPDATE_SCHEMA=1` rewrites it). `pnpm e2e:api` has a run that takes its command, `browser: false`, and an `ignore` glob from a config file.
- Rejected: JavaScript config files (`lightpath.config.ts`): loading user code before the daemon starts adds a loader and a security question for no need here. Looking in parent folders: surprising in monorepos.

### D-095 `ignore` globs match workspace paths and count as `ignored`

- Date: 2026-10-29
- Decision: `ResolveContext.ignore` holds globs, checked after a file resolves to a workspace path. A match is dropped with the new drop reason `ignored`. `*` and `?` stay inside a folder, `**` crosses folders, a pattern with no `/` matches at any depth, a match on a folder hides its contents, and matching ignores case.
- Why: Users think in project paths (`src/generated/**`), not script URLs, and the same rule then covers browser, Node, and Python files. The old `ignore` (URL substrings) was never set by anything. A separate reason tells a user their own rule hid a file, rather than "internal". Case is ignored because Windows paths reach the daemon in more than one casing.
- How: `packages/core/src/ignore.ts` (`compileIgnore`, no dependency; compiled once per context), `inWorkspace()` in `resolve.ts`, `DropReason` in `packages/protocol/src/model.ts`. All clients ship together in 0.0.1, so the new enum value needs no protocol bump.

### D-096 The M5 exit check runs through the real MCP server, and it finds the daemon from below

- Date: 2026-10-29
- Decision: `pnpm e2e` now ends by starting `lightpath mcp` as a coding agent would (MCP SDK client over stdio), calling `find_code_for_action("Checkout")`, and checking that the answer is the trace the click just made, with every file's exact line ranges. The MCP server also looks for `.lightpath/daemon.json` in each parent of its root, and reports its package version instead of `0.0.0`.
- Why: The integration test only read a hand-made trace. The exit check ("an agent answers which code handles Checkout from a real trace") needs the whole path: browser, agent, daemon, MCP. Editors don't all start MCP servers in the project folder; walking up makes the one-line setup work from a subfolder.
- How: `scripts/e2e-shop.mjs` (the daemon now writes its discovery file there), `connect()` in `packages/mcp/src/server.ts`, a CLI test that starts the server in a subfolder. The CLI's `--version` reads its package.json the same way.


### D-097 Report the press pause against page size, and the closing read beside it

- Date: 2026-10-29
- Decision: The Actual benchmark (`bench/actual.mjs`) reports, per sidebar link and for all 199 presses: page size at the press (every function any read has returned so far), press pause p50 / p99 / max, closing-read size (functions, app functions, browser files, p50), and closing-read time p50 / p99. The press pause is the number compared with the 20 ms budget. The README says the press read finds 0 app functions by design and that the closing read runs after the settle window with the page running. The sync server is measured with direct HTTP requests, because Actual's demo budget sends it none. The M3 numbers (`browser-pause.mjs`) stay as they are.
- Why: The first smoke run printed "0 functions per read", which looked like Lightpath collecting nothing. Two causes: the script read the wrong field, and the press read really is empty, since nothing in the app ran since the previous click's closing read. Its cost still scales with every function V8 has compiled for the page, and the page is paused during it (the hook's `debugger;`, `collector.ts` 99 and 104), so it is the pause that can drop a mouse release. The closing read (`collector.ts` 306) runs after `#resume()` (278) and the settle window (300), so it is longer but costs no input. Showing size next to each time keeps an empty read from looking like a broken one. M3 measured the same press read the same way, so its numbers stay comparable.
- How: The bench times each `Profiler.takePreciseCoverage` by wrapping Playwright's CDP session in the script; nothing in `packages/` changed. Raw output of the published run: `results-bench-actual.txt` in the trial folder (not in the repo).
- Note: Actual sits at the edge of the budget. The published run had p99 19.8 ms and max 20.2 ms with the boundary at the press throughout; an earlier full run of the same clicks, before the reporting fix, had p99 22.7 ms and moved the boundary to the release (D-082). Treat about 35,000 page functions as the size where the press boundary starts to give way.
- Rejected: Quoting only reads that return functions (the closing read): it hides the pause that matters. Leaving the press read out of the table: readers would compare the closing read with the 20 ms budget, which it is not subject to.

### D-098 The nearest control labels a click; a `data-testid` only outside any control

- Date: 2026-10-29
- Decision: `describe()` in the browser hook first looks for the nearest button, link, ARIA role, input, select, textarea, label, or `summary` around the pressed element. Only when there is none does it use the nearest `data-testid` element. D-090 is unchanged: outside both, only a leaf element's text labels a click.
- Why: On Actual, pressing the sidebar's "All accounts" link was labelled `span: __global!accounts-balance` instead of `a: All accounts` (Actual bench, D-097). The hook used one `closest()` over controls and `data-testid` together, so a balance span with its own test id inside the link was the nearest match. A test id on an inner span names a part of the control, not what the user pressed.
- How: Two `closest()` calls in `HOOK_SOURCE` (`packages/browser/src/collector.ts`). A real-browser test presses five shapes: a link with an inner test-id span (`a: All accounts 1,234.00`), a button with one (`button: Save *`), a `div` with a test id and no control around it (`div: card-total`), a link that carries the test id itself (`a: nav-home`), and `role="button"` around a test-id span (`button: Open 3`). The first, second and fifth failed on the old `describe()` (`span: …`).
- Note: An ARIA role on a large container (`role="main"`) now also wins over a test id inside it, and is labelled with its first 80 characters of text, as a plain click inside it already was.
- Rejected: Preferring a test id when it is closer than the control: it is exactly the Actual case. Dropping `data-testid` from labels: it is the best name for clickable `div`s that have no role.

### D-099 What each npm package ships in 0.0.1

- Date: 2026-10-29
- Decision: Every `@lightpath-dev/*` package is 0.0.1 and ships `dist/` without `dist/.tsbuildinfo` and without `*.map` files, plus `package.json`, the repo `LICENSE` (pnpm adds it), and a short README (the CLI also ships `lightpath.config.schema.json`). Each manifest gains `keywords`, `homepage`, `bugs`, `repository` (with `directory`), `engines.node >=22.12`, and `publishConfig.access: public`. The node-agent description now says `--require` (D-085).
- Why: The build cache is not code. The `.js.map` and `.d.ts.map` files point at `src/`, which isn't shipped, so they would only add size and dead links. Node 22.12 is the floor for every package, not just the CLI: the node-agent is loaded with `--require` on an ES module file, which needs 22.12 (ADR 0002). A scoped package is private by default on npm, so the first publish would fail without `access: public`. READMEs fill the npm page; relative links in the node-agent README pointed into the repo and break on npmjs.com, so they are absolute now.
- How: `files` negations in each `packages/*/package.json`; checked with `pnpm pack --dry-run` in each package. The JSON schema the README's `$schema` line points at is in the CLI tarball.
- Rejected: Shipping `src/` so the maps resolve: doubles the size for a debugging aid no user of 0.0.1 needs.

### D-100 The extension's bundled packages are dev dependencies, and `vsce package` builds the bundle

- Date: 2026-10-29
- Decision: `@lightpath-dev/core` and `@lightpath-dev/protocol` move to the extension's `devDependencies`, and a `vscode:prepublish` script runs `node esbuild.mjs --production`. Plain `vsce package` (and `pnpm --filter lightpath-vscode exec vsce package`) now gives a `.vsix` with only `dist/extension.cjs`, `package.json`, the README, and the license.
- Why: esbuild inlines both packages into `dist/extension.cjs`, so the `.vsix` needs none of `node_modules`. As runtime dependencies they made `vsce package` run `npm list --production`, which fails in a pnpm workspace (ELSPROBLEMS on the `workspace:*` links). `vsce` runs `vscode:prepublish` before every package, so a `.vsix` can no longer hold a stale development bundle with source maps.
- How: `extensions/vscode/package.json`; `pnpm-lock.yaml` moves the two links from `dependencies` to `devDependencies`. The `package` script keeps `--no-dependencies` as a second guard.


### D-101 The browser collector announces every script id, and sends each source once per hash

- Date: 2026-10-30
- Decision: `#pushSources` in `packages/browser/src/collector.ts` sends a `scripts` message the first time each script id shows up in coverage, and the `source` message only the first time each hash does. Before, both went out once per hash.
- Why: The 0.0.1 install test from the packed `.tgz` files found it. A fresh install's first `lightpath dev` always reloads the page once (Vite optimizes its dependencies on the first visit and reloads). After that reload every frontend file came out as `no-source`: the Checkout trace showed `server/routes/orders.ts` but "not shown: 4 no-source" instead of `Cart.tsx`. A reload parses the same files under new script ids with the same hash. The daemon looks each coverage entry up by script id (`correlator.ts`, `agent.scripts`), and the collector skipped the new ids because their hash had been sent. Any full reload did the same: the user pressing F5, an HMR full reload, a login redirect back to the same bundle.
- How: A second set, `#sentScripts`, next to `#sentHashes`. A real-browser test loads the page, reloads it, presses Enter on a button, and checks that every script id in the action delta was announced and that `app.js` source went out once. It failed on the old code.
- Reproduced in examples/shop and in the packed install: on 66a544b the repo's own, unmodified `examples/shop` under `lightpath dev` gave Checkout with `src/Cart.tsx` lines 11-14, 16-19, 21-28, 30-33, 35-44, 46-48, 50 before a Chrome reload, and after it only the backend files and "4 scripts hidden (no-source)". With the fix, the Checkout after the reload lists the same frontend files and lines as the one before.
- Note: The node agent has the same once-per-hash shape (`packages/node-agent/src/agent.ts`). It is not changed: one Node process parses each file once, and a restarted server is a new agent. It is a suspect for the Uptime Kuma `no-source` scripts after a server restart, not yet checked.
- Rejected: Sending the source again for every script id: same text, sent once per load for every file. Re-keying the daemon by hash: the delta carries script ids, and two scripts with one hash can still differ by URL and source map.


### D-102 `lightpath doctor` finds the daemon from a subfolder, the way `lightpath mcp` does

- Date: 2026-10-30
- Decision: The doctor's "Daemon for this workspace" check looks for `.lightpath/daemon.json` in the current folder and then in each parent, and names the folder when it is a parent: `running on port 50981, pid 34152 (started in C:\…\my shop)`. A stale file is named by its full path. The walk lives in `findDiscovery()` in `@lightpath-dev/daemon`.
- Why: The 0.0.1 install test ran `npx lightpath doctor` in `my shop\src` while `lightpath dev` ran in `my shop`. The doctor said "not running (start it with lightpath dev)", while `lightpath mcp` started in the same `src` folder found the daemon and answered `find_code_for_action Checkout` with the full trace. The two disagreed about the same folder, and the doctor is what a user runs when MCP looks broken.
- How: `packages/daemon/src/discovery.ts` (`findDiscovery`), `packages/cli/src/doctor.ts`. A daemon test writes the discovery file at a root and finds it from `src/components`.
- Rejected: Moving `lightpath mcp` onto `findDiscovery` in the same change: the MCP package imports only `@lightpath-dev/protocol`, and its own loop already works.
