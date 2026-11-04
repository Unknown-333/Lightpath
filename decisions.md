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
- Note: The second read no longer decides the boundary; only a read at a pointer press does (D-105).
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


### D-103 The in-editor test can run against a packed `.vsix`

- Date: 2026-10-30
- Decision: `extensions/vscode/test/editor/run.mjs` reads `LIGHTPATH_VSCODE_VSIX`. When it names a `.vsix`, VS Code's own CLI (`runVSCodeCommand` from `@vscode/test-electron`) installs it into the test's temp profile (`--extensions-dir` and `--user-data-dir` under one `mkdtemp` folder), the run passes an empty harness folder as the development extension, and `--disable-extensions` is left out. The suite logs the extension's version and path, and in this mode fails unless the path is inside that extensions folder. Without the variable nothing changes: CI's editor job still tests the source folder.
- Why: The 0.0.1 checklist needs the same in-editor test against what users install. `runTests` loads `extensionDevelopmentPath` and requires one; pointed at the source folder, VS Code would load the folder and ignore an installed copy with the same id. `--disable-extensions` turns off installed extensions, the `.vsix` included. The temp extensions folder is new for each run and holds only the `.vsix`, so the run stays as isolated as before.
- How: `LIGHTPATH_VSCODE_VSIX=<path>.vsix pnpm test:vscode`. Measured on 2026-10-30 with VS Code 1.144.0: the extension loaded from `%TEMP%\lightpath-vscode-…\extensions\lightpath-dev.lightpath-vscode-0.0.1`, Cart.tsx 34 lines and orders.ts 15 lines lit as in the trace, Clear and Replay passed.
- Rejected: Unzipping the `.vsix` and passing its `extension/` folder as the development path: it skips VS Code's install step, which is part of what a user's install does.


### D-104 How 0.0.1 is published: `docs/RELEASE.md`, and a `CHANGELOG.md`

- Date: 2026-10-30
- Decision: `docs/RELEASE.md` is the owner's checklist; `CHANGELOG.md` starts with a 0.0.1 entry headed "not published yet", dated when the owner publishes. The checklist publishes from a fresh clone of `main`; tests the packed `.tgz` files in a copy of the shop and the `.vsix` with `LIGHTPATH_VSCODE_VSIX` before anything goes out; publishes the 7 npm packages one `pnpm --filter <name> publish --publish-wait-timeout 600000` at a time in dependency order (protocol, node-agent, core, browser, daemon, mcp, cli); publishes the tested `.vsix` itself with `vsce publish --packagePath`; and uploads nothing to PyPI for 0.0.1.
- Why: `pnpm publish` checks that the tree is clean, the branch is `main`, and it matches `origin` (pnpm docs); the working checkout holds untracked scratch files, which count as dirty. One command per package stops at the first failure with the rest unpublished, and the wait lets npm finish scanning a package before a dependent one names it. `--packagePath` keeps the published extension byte for byte the one the in-editor test ran (D-103). `lightpath-agent` 0.0.1 is on PyPI since 2026-10-28 19:21 UTC, uploaded after the last `agents/python` commit (d922587), and PyPI refuses a second file with the same name; the checklist keeps the build and upload commands for the next version and says to empty `dist/` first, since it still holds the 0.0.1 files.
- How: `docs/RELEASE.md`, `CHANGELOG.md`. The copy, tsconfig and `tar` commands in step 2 were run once in a temp folder to check them; no publish command was run, not even `--dry-run`.
- Rejected: `pnpm -r publish` for all 7 at once: it also orders by dependencies, but a failure in the middle is harder to read. Bumping the Python agent to 0.0.2 so all registries show the same version: its code hasn't changed since 0.0.1.


### D-105 Only a read at a pointer press moves the click boundary

- Date: 2026-10-30
- Decision: The press budget (D-082) is checked only on the read taken while the page is paused at a pointer press. The reads after each `load` (D-081) stay, but are no longer timed. Reads at a release, at a key press and before an unload never count, and neither does the time `#emit` spends sending sources. The rest of D-082 is unchanged: the 20 ms budget, `pressBudgetMs`, the notice, and the boundary staying at the release once it has moved, after reloads too.
- Why: D-081 timed the second read after `load` to decide the boundary before the first click. On Actual Budget the page is still running then. In 1 of 3 runs that read took 20.77 ms and returned 2,029 functions, and the timed span also held about 4.2 ms of `#pushSources`: 25.0 ms in all. That moved the boundary to the release before any click, while the run's 103 press reads stayed at or under 18.87 ms. So `pointerdown` and `mousedown` code left every click's trace for no reason. D-082 already says "a coverage read at the press"; the code now matches it.
- How: `packages/browser/src/collector.ts`: `#afterLoad` drops its timer and its `#checkBudget` call, and `#click` calls `#checkBudget` only for a pointer action at the press boundary. Both load reads stay, so a load files the same background deltas as before (D-083 counts them). A real-browser test sets `pressBudgetMs: 0`, loads, reloads, presses Enter on a button, follows a link with Enter, goes back with `goto`, then presses the mouse once: that press logs `boundary press`, its `pointerdown` handler is in its trace, and the notice comes once, after it. On the old code the press logged `boundary release`. The forced-release test now makes one press at the press (its read moves the boundary), reloads, and checks a 10 ms press still clicks at the release without the `pointerdown` code.
- Trade-off: On a page where every press read is over budget (66 ms at 6,000 components, D-082), the first press now pays one long pause at the press, and Chrome can drop that click's release. D-081 avoided that by deciding at load. From the second press on, the boundary is at the release.
- Rejected: Timing only `#take` in the load read, without `#emit`: Actual's read alone was 20.77 ms, still over the budget. Waiting for the page to go quiet before a timed read: more code, and still a guess at what a press read will cost.


### D-106 The press pause stays as it is, and is documented

- Date: 2026-10-30
- Decision: The pause at a pointer press (D-024, D-082) stays as it is: the same press read, the same 20 ms budget, no new rule. `bench/README.md` records what it costs on Actual Budget after D-105. Revisit when a user reports lost clicks, or when a real app goes over 20 ms at the press.
- Why: On Actual's demo budget (about 35,000 page functions), 103 presses all stayed at the press. The page stopped for 15.00 / 17.73 ms p50 / p99, timed inside the page, under the 20 ms budget. Of that, 12.62 / 15.47 ms is Chrome's own read (`takePreciseCoverage` inside the renderer), so there is little in Lightpath's code to cut. On test pages the read follows how much code V8 has compiled, and branches cost the most: 35,000 plain functions read in 6.27 ms (p50), 35,000 functions with branches in 27.83 ms. D-105 removed the one case where a read that was not a press moved the boundary.
- How: A note at the end of the Actual section in `bench/README.md`. No code change.
- Rejected: Option B, pausing at the release from the first click on big pages: `pointerdown` and `mousedown` code would leave every click's trace on those pages. Option C, reading whole-function counts at the press: the press would lose exact lines. A second, 40 ms rule: not needed while presses stay under 20 ms.

### D-107 A release bumps only the packages whose published files changed

- Date: 2026-10-30
- Decision: 0.0.2 bumps `@lightpath-dev/browser` (the D-105 fix in `dist/collector.js`) and `@lightpath-dev/cli` (its npm page `README.md`, and its dependency on browser 0.0.2). `@lightpath-dev/protocol`, `core`, `node-agent`, `daemon`, `mcp` and the VS Code extension stay at 0.0.1. Later releases follow the same rule: a package gets a new version when a file in its tarball changes, or when it must depend on a new version of another package.
- Why: `git diff --stat v0.0.1` on the release branch touches only `packages/browser/src/collector.ts` and `packages/cli/README.md` among files that ship; every package's `files` is `dist` (cli adds `lightpath.config.schema.json`), and npm always adds `README.md` and `LICENSE`. Tests, `bench/`, `decisions.md` and the root `README.md` and `CHANGELOG.md` ship in no tarball. The extension bundles `@lightpath-dev/core` and `@lightpath-dev/protocol` (D-100), neither changed, and nothing in `extensions/vscode` changed. Republishing unchanged packages would put new version numbers on identical code. The cli pins exact versions (`0.0.2` for browser, `0.0.1` for the rest), so `npx @lightpath-dev/cli@0.0.2` installs the fixed browser with the unchanged 0.0.1 packages.
- How: The two `package.json` versions; `docs/RELEASE.md` "0.0.2" publishes browser first, then cli. Checked by packing both and installing them with the 0.0.1 packages from the npm registry into a copy of the shop: `lightpath/0.0.2`, doctor passes, and both Checkout traces (before and after a reload) list `src/Cart.tsx` and `server/routes/orders.ts` with lines.
- Rejected: Bumping all 7 packages and the extension to 0.0.2 so the numbers match: six of them would ship unchanged files under a new number, and the extension would need another Marketplace publish for nothing.

### D-108 A seeded-bug suite, fixed before any feature, measures whether Lightpath helps an agent

- Date: 2026-11-01
- Decision: `bench/agent-suite/` holds 10 seeded bugs in `examples/shop`, the rules that score them (`SCORING.md`) and a harness (`run.mjs`). 7 bugs are in the repo (`bugs/b01`..`b07`). 3 are held out in `heldout.zip` outside the repo; only its SHA-256 (`df9b1d95b622775cdbfe8d1d446a86039f8ae265aa13b68a3d05243df0936ece`), the count and the categories are committed (`HELDOUT.md`), and they run once, at the end. The suite and the rules are committed before any Lightpath feature and before any baseline run; after this, bugs and scoring change only through a new D-entry that reports the numbers before and after.
  - Bugs mix layers (frontend 3, backend 2, across 2 among the visible ones) and kinds: a duplicate function where the obvious one doesn't run, a wrong field between `src/api.ts` and the server, a swallowed error, React state mutated in place, event wiring, a wrong condition and a wrong lookup. Each `notes.md` predicts, before any run, whether knowing what code ran helps: yes for 3 visible bugs, no for 3, unsure for 1, so the suite isn't built to favour Lightpath.
  - Correct fix = the hidden check passes (it tests API responses or rendered text, so any correct fix passes), the shop still typechecks, and the check files are unchanged (hashed before and after). Metrics: correct, steps (tool calls), credits (kiro-cli 2.37 reports no tokens in `stream-json`), wall time. 3 runs per bug per condition, every run reported with mean and spread, never the best run. Void: harness failure, the 15-minute timeout, or reads outside the trial folder; a void run is rerun once and void counts are reported.
  - The agent: kiro-cli 2.37.0, `claude-sonnet-5.5`, effort `medium` (the cheaper setting, the same in every condition), `--no-interactive --trust-all-tools --output-format stream-json`, prompt = `report.md` plus "Work only inside this folder, and don't stop processes you didn't start." Each trial is a fresh standalone copy of the shop outside the repo with one git commit. Conditions: `without` (built-in tools), `with` (plus the Lightpath MCP server from tarballs packed from the branch under test, plus a stub of the instructions `lightpath init` will write) and `browser` (plus `chrome-devtools-mcp@1.12.0 --isolated --headless`). All three are built; this item ran only `without`.
- Why: The owner's headline claim is that an agent with Lightpath beats the same agent without it on correct-fix rate and uses fewer steps or tokens. Fixing the bugs, the checks and the rules first, holding 3 bugs back and reporting every run is what keeps that claim from being graded by the people building the feature. The `browser` condition is there so a win can be compared with plain browser access, not only with nothing.
- How: `node bench/agent-suite/prove.mjs` applies each bug to a fresh copy: all 10 checks fail on the bugged shop and pass after `fix.patch`, and `pnpm --filter shop typecheck` passes after each fix (7 visible plus 3 held out, 2026-11-01). `run.mjs --dry-run` builds all three conditions. One smoke run, b02 `without`: correct, 5 steps, 0.344 credits, 16 s, CPU 15.3% at start and 23.3% at the end; the agent searched, read 3 files and changed one line of `src/api.ts` without starting the shop.
  - Safety, found while building the harness: with `--output-format stream-json`, kiro-cli 2.37 runs its V3 engine. A hand-written V3 `permissions` block in the agent file was not enforced (`probe-safety.mjs`: a kill-by-name and an outside delete both ran). CLI 2.x `toolsSettings.shell.deniedCommands` regexes are converted to case-sensitive globs and enforced even with `--trust-all-tools`, but a regex with 3 alternation groups, or one that starts with `.* `, converts to `*` and blocks every command. So the suite writes each word in lower, Title and UPPER case, keeps every regex to 2 groups, and `run.mjs` runs `kiro-cli agent upgrade` on a copy before each trial and refuses a conversion that contains `*`. The final probe blocked `taskkill /IM`, `Get-Process ... | Stop-Process`, `Stop-Process -Name` and `Remove-Item` on a file outside the folder, and ran `echo`, `Invoke-WebRequest -Uri http://...` and a delete inside the folder. The 5 probes used `claude-haiku-5.5` and 0.14 credits in total.
- Rejected: Letting the agent run in a copy inside the monorepo (git history and the suite itself would be readable). Installing dependencies per trial from the registry (slow and drifts; a cached template is copied instead). Effort `high` (more credits per run on the owner's overage budget, with no reason it would change the comparison, since every condition uses the same setting). Text output (no structured tool calls or credits).
- Revert: delete `bench/agent-suite/` and this entry. Nothing else in the repo depends on them: `packages/`, the shop, tests and CI are unchanged.

### D-109 A Lightpath tool result stays under 4,000 tokens, enforced as 16,000 characters

- Date: 2026-11-01
- Decision: Every Lightpath MCP tool result stays within a budget N of 4,000 tokens (counted as characters / 4), enforced as a hard cap of 16,000 characters. When a trace is bigger, Lightpath ranks and cuts its own output and ends it with one line saying what was left out and which call shows it. The owner accepted N on 2026-11-01.
- Why: In 15 headless runs (kiro-cli 2.37.0, model `claude-sonnet-5.5`, 3 runs per size), the agent found a fact in the middle of a trace-shaped tool result 3 of 3 times at about 1,000 and 4,000 tokens (4,039 and 16,014 characters), and 0 of 3 times at 10,000, 25,000 and 50,000 tokens. Kiro CLI cuts any tool result over 30,000 characters down to its first and last 500 characters plus a file path, so the model never sees the middle. That cut is measured, not documented by Kiro: its MCP, Tool Search and settings pages don't mention it (read 2026-11-01). It is a first result: 3 runs per size, one model, one agent, and nothing between 16,014 and 30,000 characters was run. From docs, not run here: Claude Code warns past 10,000 tokens and moves results past 25,000 tokens or 50,000 characters to a file; Copilot CLI moves results past 30 KB to a file; Cursor and VS Code document no number. 16,000 characters is under every cap found, with room for a header and for a tokenizer that counts more than characters / 4. Evidence: [docs/research/agent-mcp-behavior.md](docs/research/agent-mcp-behavior.md); raw runs in `lightpath-trials/goal/agent-mcp-raw/` (`results.json`, `summary.txt`).
- How: Not built yet. The Phase 2 design turns it into the output format, and a check in `pnpm e2e` will assert that the shop's Checkout trace text is at most 16,000 characters. Credits for the 15 runs: 2.859 in total, 0.080 to 0.281 per run.
- Rejected: 7,000 tokens (28,000 characters), just under Kiro's cut: nothing between 16,014 and 30,000 characters was measured. 25,000 tokens, Claude Code's default cap: 0 of 9 runs in Kiro past 30,000 characters. Letting each client cut long results: every client moves them to a file, and an agent with no shell or file tool can't read it back (0 of 9).
- Revert: change the one constant and drop this entry.

### D-110 A second frozen suite: 5 real bugs from tududi's own history, 2 held out

- Date: 2026-11-01
- Decision: `bench/agent-suite/realapp/` adds a real-app suite on [chrisvel/tududi](https://github.com/chrisvel/tududi) at commit `99ef6952fcbdef463f2a59e3f3c8f13e9a1dd511` (2026-10-28; React 18 + webpack 5, Express 4 + Sequelize + SQLite), the medium app Lightpath was already tested on (`docs/tested-apps.md`). It has 5 bugs, each a real fix from tududi's history re-introduced by reverting its commit: `r01`..`r03` are in the repo; 2 are held out in `heldout-realapp.zip` outside the repo, which has SHA-256 `fb0d6b0f2e6d7754a18221617f7fb791eed5a2572bf651ae078a57b201aed7d3`. Only that hash, the count and the categories are committed (`realapp/HELDOUT.md`). The suite is committed before any Lightpath feature and before any run; one trial run followed (below). It runs through the same `run.mjs` with `--suite realapp`.
  - Selection rule (`realapp/SELECTION.md`, committed in 0d4c219 before any candidate was read): the newest 5 bug-fix commits within 300 first-parent commits of the pin that (a) change code a user reaches from the UI, (b) a real user hits in normal use (no security-only, outside-service or performance-only fixes), (c) revert cleanly on the pin, and (d) a behavioural check can tell apart on a fresh database in under 3 minutes. Numbers 2 and 4 of the 5 are held out, fixed in advance. Never picked or dropped for how easily text search finds them. The walk read 33 candidates (89 commits back); every one is listed with the step that dropped it. Kept 5, so none was seeded. One reading was settled before any run: each `bug.patch` reverts the whole fix commit, its tests included, because the pin's tests name each issue and its expected behaviour.
  - Scoring: `SCORING.md` unchanged (check passes, app still typechecks, check untouched; 3 runs per bug per condition; same void rules; every run reported, never the best). App-specific setup in `realapp/README.md`: `dev.mjs` starts tududi without bash (same steps as `npm start`), webpack source maps on (`eval-source-map`), ports 3402 (API) and 8402 (web), a fresh SQLite database per check, "typechecks" = `tsc --noEmit` (the first step of tududi's `frontend:build`), 15-minute limit as for the shop.
  - Proof: `realapp/prove.mjs` 3/3 visible and 2/2 held out: each check fails on the bug, passes after `fix.patch` (the upstream fix), and `tsc --noEmit` passes after the fix. Output in `lightpath-trials/goal/realapp-raw/prove-visible.txt` (held out: inside the zip).
  - Owner's rules of 2026-11-01, 05:15 UTC: (1) **the tududi trial copy has no `.git` folder at all**, so the agent can't find the old fix with `git log`; the agent's diff is computed against a clean copy of the same files in `<trials>/_pristine/`. The shop keeps its fresh one-commit repository: the shop's bugs were written for the suite and never existed in any history, so its single commit shows nothing, while tududi's fixes are real commits that a repository (or a clone of one) could reveal. (2) **For each bug, whether its fix is in a public commit or issue**: yes for all 5 (commits, pull requests and user `[BUG]` issues on GitHub, checked with the GitHub API on 2026-11-01), so the model may know them from training. `SELECTION.md` lists the visible ones with links and dates; `HELDOUT.md` gives the yes/no count; results show it next to each bug.
- Why: The owner, 2026-11-01: a real-app suite before any feature code, 5 bugs in one real React + Node app, 2 held out, written as a user would report them, picked as bugs a real user could hit, with the same scoring, frozen and committed before any run, and both suites reported side by side. The shop is at the ceiling (21 of 21 without Lightpath), so it can't show a fix-rate difference.
- Trial run (the only run in this item): r01, condition `without`, run 1, on suite commit `153b290`: correct, 14 steps, 1.274 credits, about 9,164 tokens (estimated, D-111), 82 s; CPU 16.9% at the start, 8.9% at the end (`bench/agent-suite/results/2026-11-01-realapp-trial.md`). The shop baseline's means are 5.00 steps, 0.317 credits and 1,371 estimated tokens.
- Rejected: Actual Budget (its budget engine runs in a Web Worker that Lightpath can't trace, so fewer bugs cross a boundary it sees). Seeding bugs by hand in tududi (history gave 5 real ones, which are harder to fit to Lightpath). Reverting only the app code and leaving the fix's tests (they describe the bug and its fix). Junctioning `node_modules` into trials instead of copying (an agent's `npm install` or delete would reach the shared copy).
- Revert: delete `bench/agent-suite/realapp/`, the `--suite` option in `run.mjs`, and this entry. The shop suite, its results and everything outside `bench/agent-suite/` don't depend on them.

### D-111 Every agent run records a token figure, estimated from its transcript as characters / 4

- Date: 2026-11-01
- Decision: Each result line in `bench/agent-suite` (shop and real-app suites) gets `tokensEst`, an estimate of the tokens the run sent and received, with its two parts `tokensEstIn` and `tokensEstOut`, and `tokensMethod: "transcript-chars/4"`. The figure is computed from the run's own `stream-json` transcript: characters / 4, rounded, of the prompt and every tool result text (in), and every agent message, agent thought and tool-call input (out), each counted once. `tokensIn` and `tokensOut` stay `null`: kiro-cli doesn't report real counts. `run.mjs` writes the figure for new runs; `tokens.mjs` recomputes it from saved transcripts, and was used to add only these fields to the 21 baseline runs in `results/2026-11-01-baseline-without.jsonl` and a tokens column to its `.md`.
- Why: The owner's ruling of 2026-11-01: the shop's fix rate is already 21/21, so steps and tokens are the only numbers it can still show, and every run must record both. This adds a field to the suite after results exist, so it is a Tier 2 change and this entry comes before the harness change. It doesn't touch bugs, checks, scoring or any existing field.
- Evidence: kiro-cli 2.37.0 keeps no per-request token counts where it can be read. The `stream-json` transcript has credits per turn (`turn_completion`) and context-window use in percent (`context_usage`), whose `breakdown` gives tokens only for the tool specs (6,618 for the built-in tools in b01 run 1) and shows 0 for prompts and responses. The session store (`~/.kiro/sessions/<hash>/<session>/session.json` and `messages.jsonl`) has the messages but no usage fields. Searched 2026-11-01: the transcript, the session store, `~/.kiro/session-index`, `~/.kiro/logs` and `%LOCALAPPDATA%\Kiro-Cli\run-receipts`.
- Limits: It is an estimate, and a lower bound of what the model read. It leaves out the system prompt and the tool specs, and counts each item once, while the model gets the whole context again on every request. Characters / 4 is the same rule D-109 uses for the budget N; real tokenizers differ, more so for code. Use it to compare runs within this suite, not as a bill: credits stay the cost figure.
- Rejected: Context-window percent × window size (the window isn't reported, and the percent is the size at one moment, not what was sent). Summing the context size per request (kiro-cli reports a percent only at some requests, so it can't be summed reliably). Leaving tokens out until kiro-cli reports them (the owner asked for a figure on every run now).
- Revert: drop `tokens.mjs`, the four fields in `run.mjs`, the added fields in the baseline files, and this entry. No other number changes.

### D-112 The suite starts kiro-cli with `--trust-workspace --require-mcp-startup` in every condition

- Date: 2026-11-01
- Decision: `bench/agent-suite/lib/agent.mjs` adds `--trust-workspace` and `--require-mcp-startup` to the kiro-cli command for all three conditions, shop and real app. With `--require-mcp-startup`, kiro-cli exits with code 3 if an MCP server fails to start, and the harness counts that run as void (harness failure).
- Why: The first-wow benchmark (`bench/first-wow/results/2026-11-01.md`, run 2) found that kiro-cli 2.37 didn't start the MCP server from a trial folder's agent config: the session's tool breakdown showed 0 MCP tokens. kiro-cli's own help says `--trust-workspace` skips the workspace-trust prompt for one launch (V3 engine), which is what lets a folder's agents and MCP servers load. The suite's `with` and `browser` conditions add an MCP server in the trial folder, so without the flag they would likely run with no Lightpath or Chrome DevTools tools. `--require-mcp-startup` makes a missing server a void run instead of a silent `without` run. This is a harness fix made before any `with` or `browser` result exists.
- Evidence that `without` is unchanged: a tool-list probe in a `--dry-run` shop trial (b01), prompt `/tools`, with the old and the new flags (`lightpath-trials/goal/realapp-raw/tools-old-flags.jsonl`, `tools-new-flags.jsonl`): both sessions report the same built-in tool tokens (6,618) and 0 MCP tokens, make no tool call, and list the same 10 tools (list_directory, read_file, fs_write, fs_append, str_replace, delete_file, file_search, grep_search, code, execute_pwsh, plus disclose_context). The two probes cost 0.132 and 0.069 credits (kiro-cli sent `/tools` to the model).
- Fairness: the shop baseline (21 `without` runs) stays as recorded. The `without` agent loads no MCP server, and its agent config was already read without the flag (each baseline session records `agentMode: "bench"`), so the flags change nothing it could use. Every condition from here on gets the same command line.
- Revert: remove the two flags from `runAgent()` and this entry.

### D-113 Five MCP tools after Phase 3, and no `page_snapshot`

- Date: 2026-11-01
- Decision: After Phase 3 `lightpath mcp` has five tools: `run_action` (new), `find_code_for_action`, `get_trace` (gains drill-down by file or function, paged), `list_traces` and `diff_traces` (function level). No `page_snapshot` tool. The `tools/list` JSON stays at most 4,000 characters, checked by a test.
- Why: The lead's ruling as product owner. Today's list is 4 tools in 1,769 characters, against 25 tools in 21,060 for Playwright MCP and 32 in 29,661 for Chrome DevTools MCP (measured, `docs/research/competitors.md`); a short list is a real difference and costs agents less. Role and name, with a `within` text, named every shop target uniquely (`docs/research/browser-control.md`), so a snapshot tool isn't needed to name targets yet. 4,000 is a budget, not a measurement: five descriptions under 300 characters (D-119) plus their schemas.
- How: Design in `docs/design/agent-loop.md` sections 2 and 3. Builds 1 and 2.
- Rejected: A `page_snapshot` tool returning the aria snapshot with refs (740 characters on the shop): one more tool to choose from, and refs die on a reload. Revisit only if benchmark runs show agents can't name targets. Copying the browser MCPs' breadth (console, network bodies, screenshots): agents can add those tools.
- Note: the owner's 0.1.0 scope (2026-11-01, 05:15 UTC) adds a sixth tool, `run_request` (D-125). The 4,000-character cap covers all six.
- Revert: register or remove a tool in `packages/mcp/src/server.ts`; change the test's number.

### D-114 `run_action` clicks with a synced press on the collector's own page

- Date: 2026-11-01
- Decision: `run_action` acts on the Playwright page `lightpath dev`'s collector already owns. A click is a synced press: actionability check (`locator.click({ trial: true })`), mouse to the target's center, mouse down, wait until the collector has taken the boundary and resumed the page (capped at 2 s), mouse up. On the release boundary (D-082) the mouse goes up at once. Enter and Space go through `locator.press`. Targets: `css=<selector>`, `<role> "<name>"` (Playwright `getByRole`, default name match; one exact match wins over several partial ones), or visible text, with an optional `within` text that picks the enclosing element. The action waits for the trace's settle (300 ms quiet, 5 s cap, `timeoutMs` to change it), then one wait of at most 1.5 s after `traceEnd` until every request it tagged has its backend lines. One action at a time; a call also waits for a person's open trace to end. Outcomes: `not_found`, `ambiguous` (never clicks the first match), `not_actionable`, `no_trace`, `no_browser`, and as marked successes `timeout`, `click_lost` (a capture `click` flag in the hook) and `backend_partial`. No CDP port. The browser `lightpath mcp` auto-starts is headless.
- Why: The lead's ruling, from the measurements in `docs/research/browser-control.md` (shop, 20 Add to cart and 20 Checkout per method, Chrome 156): the synced press matched the 80 ms human-style press 20 of 20 on both actions, headless and headed, with Checkout ready in 329.6 ms p50 against 408.8 ms for the hold. `locator.click()` matched 2 of 20, `page.mouse.click()` 0 of 20, Chrome DevTools MCP `click` 11 of 20 and Playwright MCP `browser_click` 0 of 20, because Chrome drops a release that arrives during the press pause (ADR 0003). `locator.press('Enter')` matched 20 of 20. Plain text and role-and-name alone matched 2 elements for Add to cart; `within` made it 1. DOM-quiet waits return before the request finishes; the settle window doesn't.
- How: ADR 0007; design sections 4.1 to 4.5. Build 1: `packages/browser/src/collector.ts` and a new `target.ts`.
- Typing (the lead's decision, 2026-11-01, after this item asked): run_action takes an optional `fill: [{ target, within?, value }]` (at most 20 entries), filled in order with `locator.fill()` before the press, with the same target forms and errors (an error names the entry's index, never its value). `locator.fill` sends no key events, so it opens no trace (D-079): the boundary stays at the press, and the trace stays the action's. No separate typing tool: one call stays one action. The need is general: logins (tududi needs one before anything else), search boxes, any form. Fill values are secrets: never in tool output, traces, labels or logs (D-123 rule 6, with a test).
- Amended by D-127 (build 1): the actionability check sends no input; `locator.click({ trial: true })` sends a real press under Lightpath's hook.
- Rejected: A fixed 80 ms hold: works, 80 ms slower on Checkout, and a slow press read could outlast it. CDP press awaited then release: also 20 of 20, but it relies on a Chrome reply order nobody has explained, and needs its own element lookup. Snapshot refs as targets: no snapshot tool (D-113).
- Revert: remove `runAction()` and the tool; nothing else depends on them.

### D-115 The daemon gets a `POST /v1/action` endpoint, with the same token and `Origin` rules

- Date: 2026-11-01
- Tier 2: wire protocol (`docs/PROTOCOL.md`). Written before any code, as the owner asked ("The new daemon endpoint is a wire-protocol change, so write the D-entry before building it. Keep it on 127.0.0.1 with the token, like the rest of the daemon.").
- Decision: The MCP server reaches the browser through `POST http://127.0.0.1:<port>/v1/action` on the existing daemon server. Body `ActionRequest` (`protocolVersion`, `target`, `within?`, `action?`, `key?`, `timeoutMs?`, `fill?`); reply `ActionResult`: `{ ok: true, trace, boundary, settled, backend, pageUrl, warnings }` or `{ ok: false, error: { code, message, candidates?, count? } }`. HTTP status is for the transport only: 400 schema error, 401 bad or missing token, 403 any `Origin` header, 413 body over 256 KB (room for 20 `fill` values of 10,000 characters), 426 other protocol version; both action outcomes come with 200. `lightpath dev` registers its collector with `daemon.setActionRunner()` once the browser is open; until then, or with no browser, the outcome is `no_browser`. The exact shapes are in `docs/design/agent-loop.md` section 5.1, and go into PROTOCOL.md with the build.
- Why: The browser and its only CDP session live in the `lightpath dev` process, with the daemon in the same process (`packages/cli/src/dev.ts`, `ingestLocal`). `lightpath mcp` is a separate process that already reads the daemon's port and token from `.lightpath/daemon.json`. An HTTP request and reply fits one action, and reuses `authorize()` from `packages/daemon/src/auth.ts` as it is: 127.0.0.1 bind, 32-byte token compared in constant time, and a refusal of any request that carries `Origin`, so a web page can't reach it. The Node agent already POSTs to `/v1/ingest` with `fetch` and passes that check, so the MCP server can do the same.
- Alternatives: A new message on the `/v1/client` WebSocket (`runAction` / `actionResult`): works too, but the socket is a feed of pushed traces, and a long request-reply on it needs its own timeout handling; the ruling asked for an endpoint. A CDP port for the MCP server: Tier 3, and any local process could drive the browser with no token.
- Security: the token now also allows clicking in the app under `lightpath dev`. It already allows reading every trace and source, and is written with user-only permissions (ARCHITECTURE 7.2). No new port, no new reader of the token. Nothing leaves the machine.
- Evidence: ADR 0007; `docs/research/browser-control.md` ("Where it runs").
- Revert: delete the route and `setActionRunner()`. The endpoint is additive, so `protocolVersion` stays 1 and older clients don't notice.

### D-116 The default trace text is a function summary by phase; the trace model gains `phases` and `functions`

- Date: 2026-11-01
- Tier 2: wire protocol (`Trace` model and `delta` message in `docs/PROTOCOL.md`), and changing what existing tests assert.
- Decision: `run_action`, `find_code_for_action` and `get_trace` without a file or function print a function summary: header lines (trace, action, page, up to 20 requests, problem counts), then one block per phase, "before <request>" (browser), "<request>" (backend), "after the response" (browser), each with files and their functions in line order, line range, call count and not-run lines. No order inside a phase. Ranked and cut to 16,000 characters (D-109): drop whole files, background first, then by fewest hits, and end with `not shown: N files, M functions (X chars). Call get_trace with traceId "…" and file "…" to see one.` One `fit()` guards every tool. The old "not shown" line for dropped files is renamed "hidden:".
  - Wire changes, all optional (no `protocolVersion` bump): `DeltaMessage.beforeRequest?: { method, path }`; `Trace.phases?: TracePhase[]` (`kind` `before-request` | `backend` | `after-response` | `browser`, `request?` index); `Trace.functions?: FunctionHit[]` (`path`, `collector`, `name`, `startLine`, `endLine`, `count`, `notRun?`, `notRunSpans?`, `phase`). `FileHits` doesn't change. Shapes: design section 5.3.
  - Phases come from one browser coverage read in the collector's `page.route` handler before a tagged fetch or XHR continues. Navigation requests are skipped: a read inside a held navigation deadlocks (ADR 0003), and the `beforeunload` read already splits a page load.
  - The "sent by" initiator line is cut for now.
- Why: The lead's ruling, from `docs/research/call-order.md` recommendations 1 to 3. Measured on the shop's Checkout: the summary is 775 characters against 573 for today's `describeTrace()`, and names the function, its calls and its untaken branches. Coverage alone can't order calls (two orders gave identical coverage), but one read as the request left the page placed every function and ordered every cross-phase pair right (1440 of 1440), for 4.29 ms per request. A read at response arrival found 0 app functions in 20 of 20 runs. The initiator stack was right 20 of 20 but needs a model field and async stacks; revisit if the benchmark shows agents ask what sent a request.
- Tests whose assertions change (never weaker): the M5 exit check in `scripts/e2e-shop.mjs` asserted each file's exact line ranges in `find_code_for_action`; it will assert that the summary names every file, that `get_trace` with `file` prints every lit line number of that file, and that the text is at most 16,000 characters. `packages/cli/test/mcp.integration.test.ts` asserted 4 tool names and `src/Cart.tsx [browser] lines 21-22`; it will assert 5 names, the file in the summary, and lines 21 and 22 in the drill-down. `describeTrace()` and its test in `packages/mcp/test/format.test.ts` stay.
- Rejected: Call order inside a phase (sampling placed 28.33% of page functions and added about 19 ms per request in Node; breakpoints added 82.7 ms per click). Slices by default (5,471 characters on the shop, far bigger on a real app). Keeping today's line-range text (no function names or branches).
- Risk: the phase read adds latency to each tagged request; a page read is 8 ms at 12,000 functions and 66 ms at 24,600 (bench/README.md). Build 2 measures it on Actual Budget before it ships.
- Revert: switch the formatter back to `describeTrace()` and stop sending `beforeRequest`; clients ignore the optional fields.

### D-117 `get_trace` drills down to executed-code slices, read from disk by the MCP server, paged

- Date: 2026-11-01
- Decision: `get_trace` takes `traceId` and optional `file` (a path or a unique part of one), `function` (a name) and `page`. With `file` or `function` it prints the executed lines of each outermost function that ran, with numbers; each run of not-run lines folds into `// not run: lines A-B`, and an untaken block inside a line that ran gets `// not run: <text>`. Pages break between functions, then between lines, under 16,000 characters, each ending with the call for the next page. The MCP server reads the source from the workspace file, only for paths in the trace whose real path is inside a workspace root, and warns when the file changed after the trace started. Lines over 200 characters are cut. Ambiguous `file` or `function` returns the candidates.
- Why: The lead's ruling, from `docs/research/call-order.md` recommendation 5: line and within-line markers caught all 12 untaken blocks in the shop's Checkout, against 8 for line markers alone, and the largest shop file's slice was 1,580 characters. The daemon's source cache isn't the file: Node's type stripping replaces types with whitespace (Node docs, read 2026-11-01), and browser originals exist only when a map has `sourcesContent`. Reading from disk keeps the daemon's rule that it never reads files for clients (ARCHITECTURE 7.2), and adds no wire message.
- Rejected: A daemon message returning slices (a wire change for a display concern, and blanks for types). Slices in the default output (too big for real apps).
- Revert: drop the inputs; `get_trace` falls back to the summary.

### D-118 A fix is verified with `run_action` before and after, then a function-level `diff_traces`

- Date: 2026-11-01
- Decision: No new tool. The server instructions and the `AGENTS.md` block describe the loop: `run_action` → trace A; fix; `run_action` with the same inputs → trace B; `diff_traces` A B. `diff_traces` matches functions by file, name and order among same-named functions, not by line number, and prints, cut by `fit()`: problem counts and the first message that appeared or went away; requests whose status changed; functions that ran in only one trace; functions whose not-run lines changed (each side in its own numbering); functions whose call count changed.
- Why: The lead's ruling and the owner's target (c). A fix moves line numbers, so today's line-level diff shows every shifted line as changed; names don't move.
- Risk: anonymous functions are matched by their order in the file, so a fix that adds a function before them gives false "only in" lines.
- Rejected: A `verify_fix` tool that runs both actions itself (one more tool, and the agent edits between the two calls anyway).
- Revert: switch `diff_traces` back to the line diff in `packages/mcp/src/format.ts`.

### D-119 The MCP server sends `instructions`, and each tool description starts with its trigger words

- Date: 2026-11-01
- Decision: The server's `InitializeResult.instructions` is a text under 1,000 characters saying what Lightpath records, when to call it, the run_action → diff loop and the 4,000-token cap. Each tool description is under 300 characters and starts with what it does in the words an agent would search for. Starting texts (665 characters for the instructions; 286, 280, 249, 169 and 218 for the five tools) are in `docs/design/agent-loop.md` section 3. Tests check all three limits.
- Why: The lead's ruling, from `docs/research/agent-mcp-behavior.md`: with tool search on (Claude Code, Kiro IDE 1.3+ and CLI V3, Cursor; from docs), the model may see only tool names and the server instructions before it chooses. Lightpath sends no instructions today. Claude Code cuts descriptions at 4,096 characters (from docs), so 300 is far inside every limit found.
- Rejected: Leaving the descriptions as they are (they worked when the prompt named Lightpath, which doesn't test whether an agent picks it unprompted).
- Revert: delete the string and restore the old descriptions.

### D-120 `lightpath init --agent <claude-code|cursor|vscode|kiro>`, doctor checks, and a CI `setup` job

- Date: 2026-11-01
- Decision: One command per agent writes that agent's project MCP config (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` with `servers` and `type: "stdio"`, `.kiro/settings/mcp.json`), merged into an existing file. The command is `npx -y @lightpath-dev/cli@<init's version> mcp`, and on Windows `cmd /c npx …`. A file that isn't plain JSON is left alone and init prints the block to paste. It writes `lightpath.config.json` keys it lacks (`command` from `package.json`'s `dev` script and the lockfile's package manager, `autoStart: true`, D-122), and the marked block in `AGENTS.md`, and in `CLAUDE.md` when that file exists. Doctor checks each file init wrote: it parses, the command fits the OS, the command starts offline (`npm_config_offline=true`) and answers MCP `initialize` and `tools/list`, and the blocks name the server's tools. A CI job, `setup`, on ubuntu-latest and windows-latest, packs the packages, installs them in a fresh project per agent, runs init, checks the files, starts the configured command exactly as written and lists its tools, and runs doctor. No agent is installed. On Windows it also records whether a bare `npx` starts without a shell.
- Why: The lead's ruling and the owner's setup metric ("lightpath init + lightpath doctor work on a clean machine for Claude Code, Cursor, VS Code and Kiro (tested in CI), one command per agent"). Files and shapes are from `docs/research/agent-mcp-behavior.md` (from docs). `AGENTS.md` reaches all four agents except Claude Code when a `CLAUDE.md` exists (from docs). `npx` on Windows is a `.cmd` shim, and the owner's own Kiro config starts it with `cmd /c`. The version is pinned so `lightpath mcp` and `lightpath dev` speak one protocol. Doctor runs offline because a doctor that downloads a package would be a new network call (Tier 3). A JSONC parser would be a new runtime dependency (Tier 2) for one file format.
- Rejected: One native instruction file per agent (`.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `.kiro/steering/`): more files to drift. `code --add-mcp` for the VS Code user profile: not testable in CI without VS Code. A doctor that runs `npx` online.
- Risk: a committed `.mcp.json` with `cmd /c` breaks teammates on macOS and Linux; doctor flags the wrong form for the OS.
- Revert: remove the command, the checks and the job; written blocks sit between markers and can be removed cleanly.

### D-121 Errors and failed requests are attached to traces, through a new `problem` ingest message

- Date: 2026-11-01
- Tier 2: wire protocol (new ingest message, new optional `Trace` fields).
- Decision: The browser collector reports uncaught exceptions and rejections (`pageerror`), `console.error`, responses with status 400 and up (fetch, XHR, document) and network errors (`requestfailed`, skipping `net::ERR_ABORTED` from the page's own navigation), each attached to the open trace. The Node agent reports uncaught exceptions and rejections that reach the process, through `process.on('uncaughtExceptionMonitor')`, which doesn't change whether the process exits; it sends that one message synchronously before exit (a child `node` doing the POST with `execFileSync`, `NODE_OPTIONS` cleared, 2 s timeout), and attaches it to a trace only when exactly one tagged request is in flight. 5xx responses come from the status already in each request. New ingest message `problem` (`traceId?`, `at`, `kind` `exception` | `console-error` | `request-failed` | `uncaught`, `message` up to 1,000 characters, `location?`, `request?`); `Trace.problems?` (at most 50, then `problemsDropped`), `TraceSummary.problemCount?`. The default output prints counts plus the first message, redacted (D-123), at most 200 characters. Problems outside an open trace are dropped. Shapes: design section 5.4.
- Why: The lead's ruling and the owner's target (e). Every competitor studied gives errors (`docs/research/competitors.md`, P4); without them an agent needs a second tool for the most common bug signal. The agent's normal `fetch` batch can't finish once an uncaught exception ends the process, so the one crash message needs a synchronous path.
- Not covered: messages of errors that Express catches and turns into a 500. They go to the server's stderr, which Lightpath doesn't read; the 500 shows as a failed request.
- Rejected: Reading the dev command's stderr in `lightpath dev` (fragile to parse, and mixes processes). Patching `console` in the user's process (changes the app). Listening to `unhandledRejection` (adding a listener stops Node from exiting, which changes the app).
- Revert: stop sending `problem` and drop the fields; old clients ignore them.

### D-122 `lightpath mcp` starts `lightpath dev` in the background when `autoStart` is on; new config key `autoStart`

- Date: 2026-11-01
- Tier 2: config schema (`lightpath.config.json`, `packages/cli/lightpath.config.schema.json`).
- Decision: `lightpath.config.json` gains `autoStart` (boolean, default false). When a tool needs the daemon and finds none, and the config in the server's root folder has `command` and `autoStart: true`, `lightpath mcp` starts `lightpath dev --headless` there as its own child, appending its output to `.lightpath/dev.log`, waits up to 60 s for the daemon (and for run_action, the browser), and starts the tool's result with the command it ran and the log path. The child stops when the MCP server exits. Without `autoStart`, the tool returns today's "isn't running" message with the exact command, naming the config's `command` and how to turn auto-start on when there is one. `lightpath init` writes `command` (from the `dev` script) and `autoStart: true`.
- Why: The lead's ruling and the owner's target (e) and time-to-first-wow metric: the agent shouldn't need a person to start Lightpath. `command` already exists (D-094); the new key is there because auto-start turns a file in the repo into a command an agent's tool call runs, and some users auto-approve MCP tools. Writing `autoStart: true` is the user's own act through `lightpath init`; the printed command covers a repo that commits it.
- Alternatives: Auto-start whenever `command` exists (no schema change, but any cloned repo with a config would run its command on the first tool call). A detached daemon that outlives the MCP server (orphans holding ports).
- Revert: remove the key and the start path; configs that set it fail validation again, so remove the key from them too.

### D-123 Tool output redacts secrets, and never holds bodies or headers

- Date: 2026-11-01
- Decision: `packages/mcp/src/redact.ts` runs over every runtime string a tool prints (problem messages, request paths and URLs, the page URL, labels), never over source slices. Rules, each with its own test: (1) request and response bodies and headers are never collected or printed, tested with a request carrying a secret body and an `Authorization` header; (2) URL query values whose name contains `token`, `key`, `secret`, `pass`, `auth`, `session` or `sig`, any case, become `[redacted]`; (3) `Bearer <token>` becomes `Bearer [redacted]`; (4) JWT-like strings (three base64url parts, the first starting `eyJ`) become `[redacted]`; (5) `key=value` and `key: value` pairs whose key contains one of the rule 2 words get `[redacted]` values; (6) run_action `fill` values (D-114) never appear in tool output, traces, labels or logs: the MCP server replaces every occurrence of a value it sent in that call (4 characters or longer) with `[redacted]`, and the collector and daemon never log or store them. Rule 6 ships in build 1 with `fill`; rules 2 to 5 in build 4. A last test runs one trace with all of them through every tool.
- Why: The lead's ruling and the owner's target (f): "redact secrets in anything returned". Error messages and URLs are where secrets show up; trace data holds no bodies or headers today, and the rule keeps it that way. Source slices are the user's own files, which the agent can read anyway, and redacting code would garble it. The daemon keeps raw text in memory, as it keeps source code, on the user's machine only.
- Note: rules 2 and 5 over-redact (`monkey=1`). Loosening any rule later is Tier 3 (local-only security).
- Revert: not without the owner (Tier 3 to loosen).

### D-124 Phase 2 build order, gate and measures

- Date: 2026-11-01
- Decision: Build 1 (run_action), then build 2 (output), then build 5 (run_request, D-125), then build 4 (errors, auto-start, redaction), one after another, because they share `packages/mcp/src/server.ts`, `packages/mcp/src/format.ts`, `packages/browser/src/collector.ts` and `packages/protocol`. Build 3 (init, doctor, CI) runs beside them in `packages/cli` and CI only. No build starts before the real-app suite is committed (D-110). Each build's files, tests, D-entries and "done when" are in `docs/design/agent-loop.md` section 14; `pnpm e2e` gains "the shop's Checkout trace is at most 16,000 characters" in build 2. Time to first wow and the README 10-second test (`bench/first-wow`, `bench/readme-test`, built by another item) write dated results in their own `results/` folders and are re-run after build 1 merges; first wow again after builds 3 and 4. Cuts and risks are listed in the design, sections 15 and 16.
- 0.1.0 scope: the owner's six items (2026-11-01, 05:15 UTC) map to the builds in the design's "0.1.0 scope and cuts" section. Cut from 0.1.0: `page_snapshot`, the "sent by" line, call order inside a phase, the 60-90 s demo video, launch post drafts (the owner writes them), the Chrome DevTools MCP benchmark condition, and more research. After 0.1.0, in order: Next.js, WebSocket (socket.io), Python (FastAPI).
- Why: The lead's ruling; serial builds on shared files avoid merge conflicts in the files every build touches, and build 3 owns separate files.
- Revert: reorder the plan; no code depends on it.

### D-125 `run_request` sends one HTTP request to the app on loopback and returns its backend trace

- Date: 2026-11-01
- Decision: A sixth MCP tool, `run_request` (inputs `method`, `url` as a path or loopback URL, `body?`, `contentType?`, `timeoutMs?`). The MCP server makes a trace id, sends the request with `fetch` and `x-lightpath-trace: <id>`, then waits up to 1.5 s after the response on the client WebSocket's trace feed for that trace to hold a backend request, and prints it in the compact output. Only `localhost`, `127.0.0.1` and `[::1]` are allowed; `localhost` must resolve to loopback addresses only; no redirect is followed; no proxy is used. No custom headers in 0.1.0. The output never holds the request body, request headers, response body or response headers. Outcomes: `not_loopback`, `no_response`, `no_trace`, success. Size: small. Ships in 0.1.0, as build 5, after build 2 and before build 4.
- No protocol change: the Node agent's request bracket already reads the trace header (ADR 0004), the daemon already makes a backend trace for an unknown trace id (`Correlator.#pendingFor`), and the client feed already pushes traces (`DaemonClient.onTrace`).
- Why: The owner's 0.1.0 item 5: "An MCP tool for API-only backends: the agent sends an HTTP request and gets the backend lines it ran, no browser needed. Size it; if it's small, it ships in 0.1.0." It is small because it lives in the MCP server only and reuses the existing header, bracket, feed and formatter. Loopback only, because a request to another host sends data off the machine (Tier 3). No headers, because auth headers are secrets the tool would have to accept and keep out of output.
- Rejected: A daemon endpoint that sends the request (a wire change for no gain: the MCP server can reach loopback itself). Echoing the response body (redaction rule 1, D-123). Following redirects (one could lead off the machine).
- Revert: remove the tool; nothing else depends on it.

### D-126 `lightpath dev --url` waits until the URL answers, then opens the page once

- Date: 2026-11-01
- Decision: With `--url` (or `url` in the config), `lightpath dev` opened the page the moment it spawned the dev command, before the dev server listened. `page.goto` then failed with `net::ERR_CONNECTION_REFUSED`, nothing retried, and "watching" never printed. Now `packages/cli/src/ready.ts` `waitForUrl` tries a TCP connection to the URL's host and port every 200 ms, and `dev.ts` opens the page once one is accepted. It gives up after 60 s and prints `<url> did not answer within 60 s, so no browser opened. Check --url.` It stops waiting when the dev command exits. The detected-URL path (no `--url`) is unchanged: a URL printed by the command is already up.
- Why: The owner's 0.1.0 measure "time to first wow ... under 2 minutes". `bench/first-wow` run 1 (stepful, `@lightpath-dev/cli` 0.0.2 from npm) never opened the app (`bench/first-wow/results/2026-11-01.md`).
- Repro (owner's rule: in the repo's own example, on pre-fix code): `examples/shop` at agent-loop 9d894f4, ports moved to 3401/5473 in the worktree only, `lightpath dev --headless --url http://localhost:5473 -- node dev.mjs`. Vite was ready in 288 ms, but the log shows `page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5473/` and no "watching" line. On the fix, the same command printed `watching http://localhost:5473` (Vite listened on `::1` only, so the check covers both address families), and `--url http://localhost:5999` (nothing listening) printed the 60 s message and started no Chrome. Test: `packages/cli/test/dev-url.test.ts` replaces the browser with a stand-in that fetches the URL; its "answers later" and "never answers" cases fail on the old code (`[ 'refused' ]`) and pass on the fix.
- Alternatives: An HTTP request instead of a TCP check (a 404, a redirect or a self-signed certificate would need special cases; the browser shows those pages anyway). Retrying `page.goto` inside the collector (a change in `packages/browser`, and the collector's CDP setup would run against an error page). No time limit (a wrong `--url` would wait silently forever).
- Revert: revert the commit; `dev.ts` goes back to `void openBrowser(options.url)`, and `ready.ts` and its test go away.

### D-127 run_action checks actionability with no input, not with Playwright's trial click (amends D-114)

- Date: 2026-11-01 (build 1; the lead's decision on the worker's question)
- Decision: Before a click, run_action checks the target with no input at all: `isVisible()`, `isEnabled()`, its box unchanged over two animation frames ("still moving"), and `document.elementFromPoint` at its center inside the target, through open shadow roots ("covered by another element"). Any failure is `not_actionable` with that reason. Key presses check visible and enabled only. This replaces D-114's `locator.click({ trial: true })`.
- Why: The trial click is not a no-op under Lightpath. Playwright 1.64 still sends a real mouse click in a trial run and only stops it with its own capture listener on `window` (`coreBundle.js`: `_click` performs `mouse.click`, and `setupHitTargetInterceptor` blocks events when `trial` is set). Lightpath's hook listener is registered first, by the init script, so it sees that press, pauses and opens a trace. Measured: a lone `click({ trial: true })` on a button opened a trace (`button: Checkout`, `goal/build1-raw/trial-click-opens-trace.txt`, from `debug-double.mjs trial`), and with the trial in place every run_action opened two traces, one from the trial and one from the synced press. With the input-free check, the 13 new browser tests pass.
- Alternatives: Keep the trial and have the hook ignore it (no way to tell the trial's trusted press from a real one). Skip the check and let a covered or disabled target fail at the press (a disabled button then gives `no_trace` or a wrong trace instead of `not_actionable`).
- Limits: `elementFromPoint` checks the center only, as Playwright's hit-target check does. A target inside an iframe isn't supported (ADR 0007: one page only).
- Revert: put `locator.click({ trial: true })` back in `checkActionable` in `packages/browser/src/collector.ts`; the double traces come back.

### D-128 One coverage read per action, before its first tagged request only (amends D-116)

- Date: 2026-11-01 (build 2; the lead's decision on the worker's question)
- Decision: The browser collector takes the extra coverage read only as an action's first tagged fetch or XHR leaves the page, not before every tagged request. Later requests of the same action go out without waiting for a read. Phases become: before the first request (browser), each request's backend, and after (browser: all browser code after the first request left, until the trace settles). `DeltaMessage.beforeRequest` and the trace model don't change.
- Why: Measured on Actual Budget's demo budget (page about 31,700 functions): the read before a tagged request took 27.98 ms p50, 42.61 ms p99 over 50 reads (`goal/build1-raw/bench-actual-1.out`; the machine was busy, CPU 49.9% to 55.9%). Design risk 4 set 20 ms as the line to decide at. Reads run one at a time, so with a read per request a burst of N fetches would wait N reads. With one read per action, an action pays at most one read, however many requests it sends.
- Alternatives: A read before every tagged request (D-116 as written: exact phases for every request, but N reads for N requests). Turning phases off past a page size (no phases at all on the apps where they help most). Keeping the per-request read and logging the cost (the cost grows with the number of requests).
- Cost: code that runs between the first and a later request (after the first response, before the second request) lands in the "after" phase, not in a phase of its own.
- Test: `packages/browser/test/action.integration.test.ts`: an action that sends 3 tagged requests gets exactly one `beforeRequest` delta and one read.
- Revert: drop the `#readBefore` check in `packages/browser/src/collector.ts` `#onRoute`; every tagged request is read again.

### D-129 Six tools fit in 4,000 characters: shorter tool and parameter descriptions (amends D-119)

- Date: 2026-11-01 (build 5)
- Decision: With `run_request` added, `tools/list` was 4,819 characters, over the 4,000 cap (D-113). As design section 2 says ("build 5 shortens descriptions, not the cap"), the descriptions got shorter. Tool descriptions drop the parts their parameters or the server instructions already say, and the parts not built yet: run_action 295 → 227 characters ("with errors and failed requests" and "Target: button "Checkout" or text."), find_code_for_action 280 → 193 ("Input: …" and "To do the action yourself, use run_action."), get_trace 249 → 185, list_traces 169 → 124 ("error counts" and the action kinds), diff_traces 218 → 183 ("errors that appeared or went away"), run_request 282 → 228 ("and errors", "Input: …"). Parameter descriptions got shorter or went where the name says it (`traceId`'s, `file`, `function`, `label`), and `fill` items no longer repeat the target bounds (the daemon checks them and answers 400). The instructions gain the run_request clause from design section 3: 665 → 730 characters. Result: `tools/list` 3,950 characters; tests check all three limits.
- Why: the cap is the rule; the descriptions are the part the design said to cut. Error wording comes back with build 4, when traces carry errors, if it fits.
- Alternatives: raising the cap (the design says no); stripping each tool's `$schema` key by replacing the SDK's `tools/list` handler (about 340 characters, but it patches the SDK's internals).
- Revert: restore the texts in `packages/mcp/src/texts.ts` and `RUN_ACTION_DESCRIPTION` in `packages/mcp/src/server.ts`, and the parameter descriptions; `tools/list` goes back over 4,000.

### D-130 The suite's `with` condition is set up by `lightpath init --agent kiro` and runs the app under `lightpath dev`

- Date: 2026-11-01 (written before the harness change; no `with` result exists yet)
- Decision: In `bench/agent-suite`, a `with` trial is set up the way a Kiro user sets up Lightpath, using the packed branch under test:
  1. The harness packs `packages/*` from the checkout under test and installs the tarballs in the trial cache, as today (`lib/lightpath.mjs`, D-108). Nothing is published.
  2. Before `init`, the harness writes the `lightpath.config.json` keys a user of that app would write: `headless: true` for both apps (so no Chrome window opens on the owner's desktop), and for tududi `command: "node dev.mjs"` and `url: "http://localhost:8402"`, because tududi has no `dev` script and its own start scripts need bash (`realapp/README.md`). The shop needs neither: `init` writes `command: "npm run dev"` from its `dev` script, and `lightpath dev` finds Vite's URL in its output.
  3. The harness runs `node <packed cli> init --agent kiro` in the trial folder and keeps its output. `init` writes `.kiro/settings/mcp.json`, `lightpath.config.json`, `AGENTS.md`, and its block in `CLAUDE.md` when that file exists (tududi has one).
  4. The pinned agent file `.kiro/agents/bench.json` stays as in every condition (model, effort, built-in tools, deny rules, no prompt override, `includeMcpJson: false`, the same kiro-cli flags, D-112), plus two things `init` asks for: the `lightpath` server entry `init` wrote, and `"file://AGENTS.md"` in `resources` (the note `init` prints for Kiro custom agents). The entry's command changes in one way only: `cmd /c npx -y @lightpath-dev/cli@<version> mcp` becomes `node <packed cli> mcp`, because the branch under test isn't on npm and `npx` would fetch the published package from the network. The record keeps the entry `init` wrote and the one used.
  5. The steering stub that stood in for `init` (`.kiro/steering/lightpath.md`, D-108) is no longer written.
  6. Before the agent starts, the harness starts `node <packed cli> dev` (detached, its own log) in the trial folder, waits until it logs that it watches the page, and records how long that took. After the agent stops, the harness stops it by PID before the usual cleanup and the hidden check, which then start the app on their own as in every condition.
  7. Files `init` wrote are not the agent's changes: the shop trial folds them into its single initial commit; the tududi trial copies them into its clean source copy (`_pristine`). `--dry-run` for `with` also reads `tools/list` from the server entry exactly as `bench.json` gives it, and records the tool names, with no model call.
- Why: `lightpath init` exists now (PR #28, D-120), and run_action (D-114, D-115) needs the app running under `lightpath dev` with the collector's page open. Today's `with` gives the agent a hand-written stub and no running app, so run_action could not work and the stub is not what a user gets. SCORING.md already defines `with` as "the Lightpath MCP server (packed from the branch under test) and the Lightpath agent instructions"; this makes the instructions the real ones.
- Fair to the baseline: the `without` condition and its 21 shop and 15 tududi results don't change. Its `bench.json`, prompt, flags, trial folder and cleanup are byte-for-byte the same; the harness change only runs when the condition is `with` (checked by diffing a `without` dry run before and after the change, raw output in `goal/benchprep-raw/`). Bugs, checks, scoring and void rules are unchanged (D-108, D-110). What `with` gains over `without` is what a Lightpath user has: the server, the AGENTS.md block, and the app already running under `lightpath dev`. A running app is part of that gain; the `without` agent can start the app itself, and results must say that `with` starts with the app up.
- Alternatives: (a) Keep the stub and no running app: run_action fails, so `with` would measure a setup no user has. (b) Let the agent start `lightpath dev` itself from the AGENTS.md line: the agent's shell tool waits on a long-running command, and `autoStart` (D-122) isn't in the config schema yet, so most runs would spend steps on startup and the 15-minute limit. When `autoStart` ships, (b) becomes the real user flow and should replace step 6. (c) Install the tarballs into the trial's own `node_modules` so `init`'s `npx` entry resolves locally: for tududi that re-resolves a 1 GB tree and can change the app's dependencies, which `without` doesn't get.
- Smoke runs for this change are labelled smoke, are written outside `results/`, and never count in a comparison.
- Revert: restore `bench/agent-suite/lib/agent.mjs`, `lib/lightpath.mjs`, `run.mjs` and `realapp/lib/app.mjs` from before this change (the stub and no `lightpath dev`), and remove this entry.

### D-131 The editor test watches the tab in front, not the active text editor, to check Replay (amends D-093)

- Date: 2026-11-01 (build 3)
- Decision: In `extensions/vscode/test/editor/suite.cjs`, the Replay check collects the files Replay opens from `vscode.window.tabGroups.onDidChangeTabs` (the active tab of the active editor group, text tabs only) instead of `vscode.window.onDidChangeActiveTextEditor`. What it asserts is unchanged: every file of the Checkout trace comes to the front, in `replayOrder`, and the last one is lit with the trace's lines. Replay itself (`extensions/vscode/src/extension.ts`) doesn't change.
- Why: `pnpm test:vscode` failed "replay opens every file of the trace, in order" in about half the runs on this Windows machine, on old commits too (build workers: 6 of 11 runs failed, `goal/build1-raw/b2-vscode-*.txt`; this item, on 03a092c: 1 of 14 failed, `goal/vscodeflake-raw/before-*.txt`). Logging inside VS Code showed what happens (`goal/vscodeflake-raw/load-2.txt`): with the VS Code window not focused, Replay put all 8 files in front of editor group 2 in order (`activeTab=App.tsx`, `api.ts`, `Cart.tsx` and so on), but `window.activeTextEditor` stayed `Cart.tsx` in column 1 for the whole walk, so the active-editor event fired once. VS Code gives the active text editor to whichever text editor has keyboard focus before it looks at the active group (`mainThreadDocumentsAndEditors.ts` `_updateState`, "text focus has priority", read 2026-11-01). Replay uses `preserveFocus: true` on purpose, so keyboard focus stays where the user left it and the active text editor need not follow. The same failure is reproducible every time by putting focus in the Output panel before Replay (2 of 2 runs failed, `goal/vscodeflake-raw/exp-output-old-*.txt`). The old check measured where keyboard focus was, not what Replay showed. CI passes because its single xvfb window always has focus.
- Alternatives: Drop `preserveFocus` from Replay so the active editor follows (changes the product to suit a test: every step would pull keyboard focus out of the Actions view, and VS Code still ties the active editor to focus, so it is not certain to fix the test; not measured). Retry the test or add waits (hides the problem; the active editor never moves, so waiting longer doesn't help: the failed walks took the full 5 s). Delete the order check (weakens the test; rejected).
- Test: with Replay's order reversed on purpose, the new check fails (2 of 2 runs, `goal/vscodeflake-raw/mutation-reversed-*`). With keyboard focus in the Output panel, it passes (2 of 2, `exp-output-new-*`), where the old check failed 2 of 2. Before/after counts are in the PR.
- Revert: put back the `onDidChangeActiveTextEditor` watcher in `suite.cjs`.

### D-132 Build 4 details: when problem lines print, what counts once, and two test assertions that grow

- Date: 2026-11-01 (build 4, written before the assertion changes)
- Decision, in the frame of D-121, D-122 and D-123:
  - The `errors:` and `failed requests:` lines print only when their count is above 0, so a clean trace reads as before (the shop's Checkout stays 1,023 characters). They are header lines, so `fit()` never cuts them.
  - Chrome's own console line "Failed to load resource: …" isn't a `console-error` problem: it repeats a failed request, which is reported once as `request-failed`.
  - A Node `uncaught` problem whose trace the daemon doesn't know yet (a crash during `run_request`, before any delta) opens a backend trace labelled `uncaught error`. A browser problem with an unknown or missing trace id is dropped, as D-121 says.
  - Failed requests and problem request paths print without their query (the browser collector sends the path only), and every tool result goes through `redact()` (rules 2 to 5) and then the 16,000-character cap again, since `[redacted]` can be longer than what it hides. Source slices from `get_trace` with `file` or `function` are never redacted (design section 9).
  - `lightpath mcp` treats a discovery file whose daemon doesn't answer `GET /v1/health` as no daemon (a hard-killed one), so auto-start or the "isn't running" message follows.
  - Right after an auto-start, run_action retries `no_browser` (up to the 60 s start wait) and also `not_found` for up to 10 s: the app can still be rendering its first data when the browser opens. Seen in CI: the first run_action found no "Add to cart" within "Coffee mug" because the product rows weren't there yet. Only the call that started Lightpath retries; later calls answer `not_found` at once.
- Existing test assertions that change, each stricter (one more line or key checked, nothing removed): `packages/mcp/test/output.test.ts` (the function diff of a trace whose request went 500 → 201 now also expects `problems: errors 0 → 0, failed requests 1 → 0`, design 6.4 item 1); `packages/cli/test/init.test.ts` ("adds only the keys an existing config lacks" now also expects `autoStart: true`, which init writes once the schema knows the key, D-122).
- Why: keep the default output unchanged for traces with no problems, count each failure once, and keep a crash during run_request visible.
- Revert: print the lines always; count Chrome's lines; drop unknown-id crashes; restore the two assertions.

### D-133 0.1.0 moves all 7 npm packages and the VS Code extension

- Date: 2026-11-01 (release prep 0.1.0, part 1)
- Decision: Under D-107 (a package gets a new version when a file in its tarball changes), every npm package moves to 0.1.0: `protocol`, `core`, `node-agent`, `browser`, `daemon`, `mcp` and `cli`. The VS Code extension `lightpath-dev.lightpath-vscode` moves too. `lightpath-agent` (PyPI) stays at 0.0.1. 0.1.0, not 0.0.3: the MCP tools and the trace output changed in ways an agent sees (pre-1.0, a minor version can break things).
- Evidence (`goal/release1-raw/diff-since-v0.0.2.txt`, `git diff --stat v0.0.2 HEAD` over each package's `src`, `README.md`, `package.json` and, for cli, the schema file): protocol 3 files changed, core 3, node-agent 2, browser 5, daemon 5, mcp 12, cli 10. The extension's own `src`, `package.json` and `README.md` didn't change, but it bundles `core` and `protocol` (D-100), and its bundle did: `extensions/vscode/dist/extension.cjs` built at `v0.0.1` is 782,843 bytes (sha256 `3F3E4B6BBD4875D3…`), at release prep head 788,710 bytes (`5BB879ECA958DD52…`), with 126 lines added and 11 removed, all of them the protocol's new trace schemas (`TracePhase`, `FunctionHit`, `TraceProblem`, the `phases`, `functions` and `problems` fields; `goal/release1-raw/vscode-bundle-diff.txt`). `git diff --stat v0.0.2 HEAD -- agents/python` is empty.
- Note for the owner: the 0.0.1 extension still reads 0.1.0 traces. Its zod schemas drop keys they don't know, and every new field is optional, so republishing it brings no new behaviour in the editor. It moves because its packaged file changed (D-107). Leaving it at 0.0.1 is the owner's call; `docs/RELEASE.md` marks its steps as skippable.
- Revert: set the versions back; nothing is published until the owner runs `docs/RELEASE.md`.

### D-134 The agent texts lead with "the user reports a bug": reproduce it with run_action, one step per call (amends D-119, D-129)

- Date: 2026-11-01 (written before the text and test changes)
- Decision: Three texts an agent sees change, and nothing else:
  1. The `run_action` description says each call does one step, that the page, sign-in and data stay between calls, and to use it first to reproduce a reported bug step by step, and again after the fix.
  2. The server `instructions` put "when the user reports a bug they see in the app" first among the triggers, with the same one-step-per-call rule.
  3. The AGENTS.md / CLAUDE.md block from `lightpath init` leads with the same trigger and rule: sign in with `fill`, do the setup steps, then the step that shows the bug.
     The example target becomes `button "Save"` everywhere (description parameter, block), instead of `button "Checkout"`.
- Why: in the tududi smoke run `r01-with-1`, the agent loaded run_action and never called it (`bench/agent-suite/smoke/2026-11-01-why-r01-skipped.md`). Our trigger ("which code handles a button, page or request", "why an action fails") doesn't match a user's bug report ("I do X and see Y"). Nothing said a flow can be replayed one call at a time. In the shop run `b01-with-1` the agent did call it, and its report said "press Checkout", the same words as our example. The owner's focus (2026-11-01 15:25 UTC) is agents calling Lightpath by themselves.
- Tests whose assertions change (Tier 2): `packages/mcp/test/action.test.ts` pins the run_action description length (227) and its first words; `packages/mcp/test/output.test.ts` pins the instructions length (730); `packages/cli/test/init.test.ts` pins the block text. They change to the new lengths and text. The limits stay as they are and are still checked: each description under 300 characters, instructions under 1,000, `tools/list` at most 4,000.
- Fair to the suite: the texts name no app, bug, file or route. Bugs, checks, scoring and the `without` condition don't change (D-108, D-110). The neutral example removes a word that matched 3 shop reports (b02, b03, b05 name Checkout) and b01.
- Check: up to 3 tududi `with` runs on r02 and r03 (not r01, the bug the diagnosis came from), item cap 4.5 credits. They are checks, not benchmark results.
- Alternatives: a stronger "always call run_action first" rule (pushes the tool where it doesn't help, like a typo fix); naming the deferred-tool step for Kiro (client-specific, and the agent already loaded the tool); leaving `Checkout` as the example (it helps the shop suite by wording, not by the tool).
- Revert: restore `RUN_ACTION_DESCRIPTION` and `targetSchema` in `packages/mcp/src/server.ts`, `INSTRUCTIONS` in `packages/mcp/src/texts.ts`, `agentsBlock` in `packages/cli/src/init.ts`, and the three tests' pinned values.

### D-135 The collector reloads its first page when that load's own scripts failed, at most 3 times (amends D-126)

- Date: 2026-11-03 (written before the code and test)
- Decision: In `BrowserCollector.start()` (`packages/browser/src/collector.ts`), the first page load is checked once `page.goto` returns. If a script from the page's own origin answered 400 or more, or failed to load, during that load, the collector waits 1 s and reloads the page. It checks again after each reload, up to 3 reloads, and logs each one. If the scripts still fail after 3 reloads, it tells the user once, in the CLI's yellow notice, and leaves the page as it is. Only the first load is checked; later loads (an action's navigation, the user's own reload) are never reloaded.
- Why: on tududi, the page `lightpath dev` opened stayed blank, so run_action found no sign-in field (`bench/agent-suite/smoke/2026-11-01-why-r01-skipped.md`). No-model probes (`lightpath-trials/goal/signin-raw/`) show the cause:
  - tududi's webpack dev server compiles twice at start: "compiled successfully" at 3.92 s, then again at 5.91 s (`http-timeline.out`).
  - Between the two, `/` answers with HTML that names `main.6f55e86212aec1a1c9c8.js`. Once the second compile finishes, that file is gone: it answers 404 with `text/html` (the dev server's index fallback), and Chrome refuses to run it. From 6.62 s, `/` names `main.e3663fbc8380b35cc6ee.js`, which answers 200.
  - `lightpath dev` waits until the URL answers, then opens the page once (D-126). The page opened inside that window, its bundle never ran, and nothing reloaded it: no app, no live-reload client. The same thing happens with and without the Node agent (`inproc-agent.out`, `inproc-noagent.out`). Lightpath's own collector, opened after both compiles, reaches `/login` with both fields, and its run_action signs in (`collector-probe-action.out`).
  - A person would press reload. An agent using run_action can't, so Lightpath must.
- What is tududi's and what is Lightpath's: the double compile is tududi's own webpack setup, and the harness only starts it. Lightpath's part is opening once with no way back from a failed first load. Any dev server that rebuilds right after it starts answering can cause it.
- Alternatives: (a) Wait longer before opening (a fixed delay is a guess, and it slows every app). (b) Wait until `/` answers the same HTML twice in a row (the two HTML answers here are the same size; a hash compare would work for webpack but not for an app whose HTML changes on every request). (c) A `reload` option for run_action (gives the agent a step to spend, and a fresh agent doesn't know the page is broken). (d) Reload on any failed script at any time (would reset the app state in the middle of a person's work).
- Test: `packages/browser/test/collector.integration.test.ts`, "reloads the first page when its own script failed to load (D-135)": a fixture server answers the first `/` with HTML that names a bundle which then answers 404, and every later `/` with a working page that renders a form. Before the fix the page has no field; after it, the field is there and run_action can fill it.
- Revert: remove the reload loop in `BrowserCollector.start()` and the test; the first page opens once, as before.

### D-136 The README GIF runs on a new example app, `examples/invoices`, recorded by script from a real agent run

- Date: 2026-11-04 (written before the app and the scripts)
- Decision: The owner asked for a good-looking, professional demo app for the GIF (2026-11-04 02:12 UTC). We build option (a): a new example, `examples/invoices` ("Harbor Billing", an invoices dashboard in React + Vite with an Express API), and don't use a third-party app (option b). The GIF shows one real kiro-cli run on a copy of it with one planted bug: the user reports it, the agent calls `run_action`, reads the trace and fixes the code.
- Why (a), not (b):
  - Control over what the viewer reads. A 10-20 s GIF has room for one bug, a handful of files and one trace. The real apps we ran have hundreds of files on one click (Actual: 263 frontend files, `docs/tested-apps.md`), so the trace in the GIF would be cut to a few lines anyway.
  - No licence or credit risk, and nothing to vendor or download in CI. tududi needs webpack source maps turned on and compiles twice at start (D-135), which makes a demo fragile.
  - `examples/shop` and `bench/` stay as they are: the frozen suite uses them (D-108, D-110).
  - Honesty: the bug is planted, and the README says so under the GIF. A real app would also need a planted bug, since its real fixed bugs are public (D-110).
- How:
  - `examples/invoices`: React 19 + Vite on port 5174, Express 5 under `tsx watch` on 3002 (the shop keeps 3001/5173, so both can run). Plain CSS, no UI library. The data is made up.
  - Its CI test, `scripts/e2e-invoices.mjs` (`pnpm e2e:invoices`, in the CI job "end-to-end"): the MCP server auto-starts `lightpath dev` from the app's config, `run_action` clicks "Mark as paid", and the test checks that the trace has the React file, the Express route and the service, and the request with its status.
  - The bug: one line that clears the summary cache after a payment is left out in the run's copy (`examples/invoices/demo/record-run.mjs` removes it and checks that it did). The app in the repo has no bug.
  - Recording, by script only: the agent's MCP calls act on Lightpath's own browser (the collector page, headless). Its frames come from a DevTools screencast of that page through Playwright, with the time each arrived. No OS screen capture, mouse or keyboard. The terminal side is drawn from the run's own stream-json transcript (each line timed as it arrived). `examples/invoices/demo/render-gif.mjs` puts both side by side and encodes the GIF in JavaScript (`gifenc`, a dev dependency of the example only), because no full ffmpeg is on this machine.
  - The run's prompt, transcript, timings, kiro-cli version, model, credits and steps are committed in `docs/media/demo-run/`.
- Rejected: (b) a real open-source app, for the reasons above; filming VS Code (the extension is low priority, owner 2026-11-01); a staged terminal typed by a script (the owner asked for a real run).
- Revert: delete `examples/invoices`, `scripts/e2e-invoices.mjs`, its CI step and `docs/media/demo-run/`, and point the README at the old `docs/media/demo.gif`.

### D-137 0.1.0 leaves the VS Code extension at 0.0.1, and the release notes carry the benchmark as measured (amends D-133)

- Date: 2026-11-04 (release prep 0.1.0, part 2)
- Decision: The VS Code extension `lightpath-dev.lightpath-vscode` stays at 0.0.1 in 0.1.0: its `package.json` version goes back from 0.1.0 to 0.0.1, and `docs/RELEASE.md` drops its publish step. The 7 npm packages still move to 0.1.0 as D-133 says. The CHANGELOG's 0.1.0 entry gets the full benchmark result in place of its placeholder.
- Why: the owner, 2026-11-01 15:25 UTC: "the main focus should be mcp right now that will be used by ai agents autonomously; extension is not on the priority list". D-133 already found that republishing brings no new behaviour in the editor: the 0.0.1 extension reads 0.1.0 traces, because its zod schemas drop unknown keys and every new field is optional. D-107's rule (a new version when a packaged file changes) is about what gets published; a package that isn't published this time keeps its old number.
- Benchmark text: copied from `bench/agent-suite/results/2026-11-03-full-benchmark.md`. It says plainly that Lightpath did not raise the fix rate and that runs with it cost more, and it gives both numbers where the void-check flaw applies.
- Alternatives: republish the extension at 0.1.0 (rejected: owner's priority, and no behaviour change); leave its version at 0.1.0 unpublished (rejected: the repo would name a version the Marketplace never had).
- Revert: set `extensions/vscode/package.json` back to 0.1.0 and restore step 5 of the 0.1.0 section in `docs/RELEASE.md` from D-133's commit.

### D-138 The README GIF moves to tududi, a real open-source app, with a planted bug and a real agent run (amends D-136)

- Date: 2026-11-04
- Decision: The README GIF (`docs/media/tududi-demo.gif`) shows one real kiro-cli run on a local copy of [tududi](https://github.com/chrisvel/tududi) at commit `99ef6952`, the copy the real-app benchmark uses (D-110). One bug is planted for the demo. The user reports it ("I click Plan your day and my high-priority task comes last"), the agent calls `run_action`, gets the browser and server lines, reads the file the trace names and fixes it. `README.md` and `packages/cli/README.md` point at the new GIF and credit tududi under it.
- Why: the owner, 2026-11-04 03:45 UTC, about the D-136 GIF on `examples/invoices`: "the gif is not good at all. use this on a real site real product which looks professional and real." A viewer can't tell a demo app from a product; a known app answers that.
- The pick, from the apps we have run (`docs/tested-apps.md`):
  - tududi (chosen): a polished, real product (React 18 + Tailwind, Express 4 + SQLite), MIT. Its "Plan your day" click sends one request, `GET /api/daily-plan/candidates`, and the trace names `backend/modules/daily-plan/ranking.js`, the file that orders the list. It is already set up for Windows by the benchmark (`bench/agent-suite/realapp/dev.mjs`), so no new setup work.
  - Actual Budget (rejected): it looks very good and is MIT, but its budget engine runs in a Web Worker, which Lightpath doesn't trace (`docs/tested-apps.md`). Most clicks would show browser files and no server lines, which is the opposite of the pitch.
  - Uptime Kuma (rejected): Vue, not React, and most actions are socket.io messages, which show no backend.
  - stepful/fullstack_boilerplate (rejected): a starter template, not a product.
- Licence: tududi's `LICENSE` is MIT ("Copyright 2024, 2025 Tududi Developers"), checked in the copy on 2026-11-04. MIT allows using, copying and modifying it, so a modified local copy can be run and shown. The credit under the GIF names it, its link and its licence. Its code is not committed here.
- The bug: `scripts/demo-gif/bug.patch` swaps `a` and `b` in one priority comparison in `orderCandidates`, so low-priority tasks come first. Picked because a user sees it in one click and says it in their own words, and it is a one-line change in the file the trace names. It is made up, not one of tududi's real fixed bugs, so the model can't know the fix from tududi's history. The benchmark's bugs (`bench/agent-suite/realapp/bugs`) are not used or changed.
- How: same pipeline as D-136. `scripts/demo-gif/record-tududi.mjs` builds the copy without `.git`, applies the patch, runs `lightpath init --agent kiro`, starts the app under the Node agent and Lightpath's own headless browser, signs in and adds 5 tasks through tududi's API, then films that page with a DevTools screencast while kiro-cli runs. `scripts/demo-gif/render-gif.mjs` draws the GIF from the screencast and the transcript: 1000×600, text 17-19 px, 5 scenes (bug report, click, trace, fix, before/after). No OS screen capture, mouse or keyboard. It uses its own ports (3412/8412), so a benchmark run can go on beside it.
- The "after" picture: the agent fixed the file but could not see the result, because tududi's server runs under plain `node` and doesn't reload, and its own recheck failed (the page was already on the plan). `record-tududi.mjs --after` restarts the same copy and clicks once by script. The GIF and the run's README say that this picture is from the script, not the agent.
- The run: 2026-11-04 04:07 UTC, kiro-cli 2.37.0, `claude-sonnet-5.5`, 6 tool calls (2 of them `run_action` calls that failed with `not_found`), 0.678 credits, 31.5 s. Everything is in `docs/media/tududi-run/` (`run.json`).
- No Lightpath change was needed: the trace came back on the first right target.
- Kept: `examples/invoices`, its CI test, `examples/invoices/demo/` and `docs/media/demo-run/` stay; the README's "What your agent gets" block still quotes that run's short trace, and says it is from the example app. `docs/media/agent-demo.gif` stays as that run's record. `examples/shop` and `bench/` are not changed.
- Rejected: Actual Budget, Uptime Kuma and stepful (above); a new example app (D-136's choice, which the owner turned down); re-adding a real tududi bug (its fix is public, D-110).
- Revert: point both READMEs back at `docs/media/agent-demo.gif` with D-136's captions, and delete `scripts/demo-gif/`, `docs/media/tududi-demo.gif` and `docs/media/tududi-run/`.

### D-139 A run_action miss on a sign-in page says so, with a ready call built from the page's own fields (0.1.1, fix 1 of the steps audit)

- Date: 2026-11-04 (written before the code)
- Decision: When run_action's target (or a `fill` target) matches nothing and the page has a visible password field, the `not_found` message gets a second part after "No element matches …": "This page is a sign-in form (it has a password field), so the app is not signed in here. Sign in first with its own fields, …" and one `run_action {…}` line, as JSON the agent can send. The call is built from the page: the text fields of the form that holds the password field (up to 4, by role and name, else by `css=` id, name or type) and that form's submit button. Without a submit button, the call presses Enter in the last field. The values are `<email>`, `<password>` placeholders, named after the field. No typed or stored value is ever read: the code reads roles, names and attributes, and only the part of an aria snapshot before the value. The "Closest targets on the page" list stays as it was.
- Why: the steps audit (PR #59, `bench/agent-suite/results/2026-11-04-where-steps-went.md`, section 3) found that all 7 tududi run_action misses were on the Login page: 4 runs assumed they were signed in, and 3 asked for `button "Sign in"` when the button says "Login". The error already listed `button "Login"`, `textbox "Email"` and `textbox "Password"`, but only 1 of the 7 runs tried again.
- Where: `packages/browser/src/target.ts` (`signInForm`, `signInHint`, called from `resolveTarget`'s not_found branch). The wire protocol doesn't change: `ActionError.message` is free text (`docs/PROTOCOL.md`), and the collector still scrubs fill values from it.
- Tests: new `signInHint` unit tests (`packages/browser/test/target.test.ts`) and a new browser test on a sign-in page that follows the hint's call and signs in (`action.integration.test.ts`). No existing assertion changes.
- Size: the hint adds about 400 characters to a miss, far under the 16,000 cap (D-109). The probe on tududi (`C:\Users\user\lightpath-trials\goal\fix011-raw\`) has the before and after text for the audit's exact arguments.
- Alternatives: a new `ActionError` field for the form (a protocol change for text the agent reads anyway); detecting sign-in from the candidate names in the MCP server (misses pages whose password field isn't among the 10 closest names); signing in by itself with stored credentials (that is fix 7, for 0.2.0, and touches local secrets).
- Revert: drop the `signInForm` call in `resolveTarget` and the two functions, and the new tests.

### D-140 A shorter run_action schema: no bounds the daemon already checks, and one `press` key (amends D-129, D-134; 0.1.1, fix 2 of the steps audit)

- Date: 2026-11-04 (written before the code and test changes)
- Decision: The schema and description of `run_action` that an agent loads get shorter, and nothing that D-134 added goes:
  1. The description says the same things in fewer words (280 → 260 characters): one step per call, page, sign-in and data stay between calls, use it first to reproduce a reported bug step by step, and again after the fix.
  2. `target`, `within`, `timeoutMs` and `fill` lose their length, range and item bounds in the MCP schema. The daemon checks the same bounds (`ActionRequest` in `@lightpath-dev/protocol`) and answers 400, which run_action shows as an error. D-129 did the same for `fill` items.
  3. `action` and `key` become one optional `press: "Enter" | "Space"` ("Press this key instead of clicking"). The MCP server turns it into `action: "press"` and `key` for the daemon, so the wire protocol doesn't change. In the 62 run_action calls of the benchmark, `action`, `key` and `timeoutMs` were used 0 times (steps audit raw data, `explore2.txt`).
  4. `docs/agents/kiro.md` says that Kiro CLI loads tools through one `tool_load` step, with the audit's numbers.
- Why: the steps audit (PR #59, section 5) found the `tool_load` text was 37,221 tokens over 53 runs, more than all Lightpath results (26,534); 15,530 of them were in runs that never called Lightpath. Rebuilt from `tools/list` the way Kiro prints it, 0.1.0's run_action load is 2,409 characters, the same as the `tool_load` result in the benchmark transcript of b04-with-1 (`C:\Users\user\lightpath-trials\goal\fix011-raw\toolload-before.txt`, `rebuildMatchesTranscript: true`).
- Tests whose assertions change (Tier 2): `packages/mcp/test/action.test.ts` pins the run_action description length (280 → 260) and now also checks D-134's three points are in it. The limits stay and are still checked: each description under 300 characters, instructions under 1,000, `tools/list` at most 4,000. New tests: run_action's Kiro `tool_load` text is under 0.1.0's 2,409 characters (`output.test.ts`), and `press: "Space"` reaches the daemon as a Space key press (`loop.test.ts`).
- Not changed: the other five tools' texts and the server instructions. The `tool_load` step itself is Kiro's (Tool Search); turning it off is the user's choice, and it would send every schema with every request instead.
- Breaking for callers: a call with the old `action: "press"` and `key` now clicks, because the MCP SDK drops keys the schema doesn't name. Agents read the schema they load, and no Lightpath text or doc named those keys. Before 1.0, tool input formats are Tier 1.
- Alternatives: dropping `timeoutMs` too (0 uses, but slow apps need the settle cap); trimming all six descriptions (the audit's load cost is mostly run_action: 53 of 53 runs loaded it); stripping `$schema` by patching the SDK's `tools/list` handler (D-129 rejected it).
- Revert: restore `RUN_ACTION_DESCRIPTION`, `targetSchema`, `withinSchema` and the run_action input schema in `packages/mcp/src/server.ts`, the pinned length in `action.test.ts`, and drop the two new tests and the kiro.md lines.

### D-141 A trace with 3 or more backend requests shows each shared backend file once (0.1.1, fix 3 of the steps audit)

- Date: 2026-11-04 (written before the code)
- Decision: In the default trace text (`summarizeTrace`, used by run_action, run_request, find_code_for_action and get_trace without a file), when a trace has 3 or more backend phases, a backend file whose functions ran in 3 or more of them is taken out of each request's block and shown once, in a section `in 3 or more requests [backend, shown once]` after the phases. Its first line says in how many of the requests it ran (`backend/app.js (in 13 of 13 requests)`); each function shows its calls added up over those requests, with `(in N)` when it ran in fewer of them, and a line counts as not run only when no request ran it. Files that ran in one or two requests stay under their own request. A footer line says what was folded, how many characters that saved, and the `get_trace` call that shows one folded file's lines (that view lists the phases it ran in). Under the 16,000 cap, the files left out are the ones the unfolded text would leave out (`droppedFiles` in `budget.ts`), so folding never brings in files and the text only gets shorter; the footer counts only shared files that stay in view.
- Why: the steps audit (PR #59, section 5) found the 4 tududi Login traces were 14,906 to 15,360 characters, close to the cap, and 32.4% of their text (19,566 characters) was 4 backend files that repeat under 3 or more requests: `backend/app.js`, `backend/middleware/queryLogger.js`, `backend/middleware/rateLimiter.js`, `backend/services/permissionsService.js`.
- Measured without a model (`C:\Users\user\lightpath-trials\goal\fix011-raw\login-same.json`): the same stored tududi Login trace (13 requests) rendered by main's and this branch's `summarizeTrace` is 14,810 → 11,441 characters (−3,369, −22.7%). The fold line names 4 files, the same 4 the audit named, and the same 72 files are left out in both.
- Format change agents see: yes, for traces with 3 or more backend requests only. The shop's traces have at most 1 backend request per click in the suite, so their text doesn't change. No existing test assertion changes.
- Tests: two new tests in `packages/mcp/test/output.test.ts`: the exact folded text for a 4-request trace (and no fold for 2), and a 13-request trace over the cap that keeps every per-request file and comes out more than 5,000 characters under it. Both fail on main.
- Alternatives: fold at 2 requests (saves little and changes more traces); fold browser files that repeat across phases too (they show the before/after split of one click, which matters for a click bug); let the freed room take more files (the text stays at the cap, and the audit's cost is tokens).
- Revert: drop the `shared` map, `foldShared` and the fold line in `summary.ts`, and the `basis` parameter and `droppedFiles` in `budget.ts`, and the two tests.

### D-142 run_action takes `times` (1 to 5): the same action repeated, one merged trace (0.1.1, fix 4 of the steps audit)

- Date: 2026-11-04 (written before the code)
- Decision: `run_action` gets an optional `times`, an integer from 1 to 5 ("Repeat it; one trace, counts added"). The MCP server sends the same action to the daemon that many times, one after the other, and stops at the first run that records no trace. It returns one text: the trace of all the runs merged (`mergeTraces` in `packages/mcp/src/merge.ts`), with a `repeated: 2 of 2 runs (t_a, t_b); line and call counts below are added up over them. get_trace on t_b shows the last run alone.` line after the page line, and a `warning (repeat_stopped): run 3 of 4 did not record a trace: …` line when a run missed. Merging matches requests by method and path in order, phases by kind and request, and functions by phase, file, name and lines; calls and line hits add up, and a line is "not run" only when no run ran it. The id, label and request statuses are the last run's. `timeoutMs` drops `.int()` in the MCP schema to make room (zod writes the whole safe-integer range for it, 60 characters); the daemon still checks it is an integer from 500 to 30,000.
- Wire protocol: unchanged. The repeat happens in the MCP server, so `/v1/action` and `ActionRequest` stay as they are, and each run is its own trace in the daemon's store.
- Why: the steps audit (PR #59, section 3) counted 13 run_action calls that repeated the same arguments right after a good trace (b03-with-2 made 5). Some bugs need it: b04 says "press Add to cart on the Desk lamp twice".
- Measured without a model on the shop with b04's bug (`C:\Users\user\lightpath-trials\goal\fix011-raw\shop-before.txt`, `shop-after-fix4.txt`): the two presses before the fix were 2 calls and 888 characters (485 + 403) on main; with `times: 2` they are 1 call and 633 characters. After the fix: 2 calls and 1,040 characters on main, 1 call and 683 characters with `times: 2`.
- Size: `tools/list` stays under 4,000 (3,905 with `times`); run_action's Kiro `tool_load` text is 2,188 characters, under 0.1.0's 2,409 (the D-140 test still passes).
- Tests: new `packages/mcp/test/merge.test.ts` (matching, adding up, not-run only when no run ran it, inputs left alone) and three `times` tests in `loop.test.ts` (2 runs merged, stop at the first miss, 6 refused). All fail on main.
- Alternatives: a `times` field in the daemon's `/v1/action` (one trace for all presses, but a protocol change, Tier 2, for the same answer); returning every run's trace in full (the cost `times` is meant to cut); a higher cap (5 covers every repeat in the audit).
- Revert: drop `times`, `repeated`, `repeatedLine` and `MAX_TIMES` in `server.ts`, the `notes` parameter of `describeActionResult`, `merge.ts`, and the new tests.

### D-143 find_code_for_action with nothing recorded answers with the run_action call to make (0.1.1, fix 5 of the steps audit)

- Date: 2026-11-04 (written before the code)
- Decision: When no recorded trace matches, `find_code_for_action` says so and gives the exact call that records it, with the agent's words as the target: `run_action {"target":"Set in progress"}`. A last line says to do sign-in or setup steps first, each with its own run_action call, or to ask the user to click it. Before, it said only "Do it with run_action, or ask the user to click it …, then try again."
- Why: the steps audit (PR #59, section 3) found 4 find_code_for_action calls, all before any action, and 0 useful: each got "No recorded action matches …", and the next step was a text search every time. The tool was loaded in 16 runs.
- Measured without a model: the miss text grows from 143 to 273 characters for "Upcoming" and from 150 to 287 for "Set in progress" (tududi), and from 149 to 285 for "shop page load" (`C:\Users\user\lightpath-trials\goal\fix011-raw\`). The target is text, so a word that isn't on the page gets run_action's own not_found answer with the closest targets (and, on a sign-in page, D-139's hint).
- Format change agents see: this one message. No existing test asserted it. New test in `packages/mcp/test/loop.test.ts`: the exact text, and that sending its call to run_action records the action. It fails on main.
- Not changed: the `lightpath init` block's line about find_code_for_action and the tool description. The audit also proposed listing find_code_for_action in AGENTS.md only for a click the user made; that changes a pinned init test for a text effect no run has measured, so it is left for a measured change.
- Alternatives: running the action from find_code_for_action (it is the tool that does not act; run_action is); listing recent labels (labels like `button: login-submit` don't match the words a user reports).
- Revert: restore the old message in `server.ts`, drop `noRecordedAction` in `format.ts` and the test.

### D-144 run_action takes `compareTo` (a trace id or "last"): the new trace plus the function-level diff in one call (0.1.1, fix 6 of the steps audit)

- Date: 2026-11-04 (written before the code and test changes)
- Decision: `run_action` gets an optional `compareTo` ("Trace id, or "last": adds the diff"). After the action, the MCP server reads the reference trace from the daemon (`"last"` is the newest earlier trace with the same label, not one from this call) and puts `diff_traces`'s function-level diff (`diffFunctions`, or the line diff for traces without functions) after the new trace, separated by a blank line, with a `compareTo: t_x; what changed against it is at the end.` line in the header. The diff gets at most 6,000 characters and the trace the rest of the 16,000. With `times`, the diff is against the last run. No reference: a `compareTo:` line says so and the trace comes back alone. Anything that is neither a trace id nor `"last"` is refused before any action. `diff_traces` stays for any two traces.
- Texts that point to it: the server instructions end with "To check a fix, call run_action again with compareTo "last": it adds what changed." (was: "call run_action before and after it, then diff_traces with both trace ids"), and the `lightpath init` block's line becomes "After a fix, call `run_action` again with the same target and `compareTo: "last"`: it returns the new trace and what changed, function by function." The four `docs/agents/*.md` pages say the same; `docs/agents/vscode.md` also moves from `action: "press"` to `press: "Enter"` (D-140).
- Why: the steps audit (PR #59, sections 1 and 3) found 24 run_action calls after the first edit, in 12 runs, checking the fix, and 0 diff_traces calls in 53 runs. The agents re-ran the action and read the new trace alone.
- Measured without a model on the shop with b04's bug (`C:\Users\user\lightpath-trials\goal\fix011-raw\shop-before.txt`, `shop-after-fix6.txt`): after the fix, main took 2 run_action calls (1,040 characters) and gave no diff, and a diff would have been a third call; this branch takes 1 call (`times: 2, compareTo: "last"`, 1,342 characters), and its diff shows `src/Cart.tsx Cart` running only after the fix, which is the bug's symptom (the subtotal didn't re-render).
- Tests whose assertions change (Tier 2): `packages/mcp/test/output.test.ts` pins the instructions length (896 → 888) and now checks it names `compareTo "last"`; `packages/cli/test/init.test.ts` pins the block's "After a fix" line. The limits stay and are checked: instructions under 1,000, descriptions under 300, `tools/list` at most 4,000 (3,988 now). New tests in `loop.test.ts`: `"last"` with `times` gives the exact diff, an id works, a first trace and a bad value are handled, and trace plus diff stay under 16,000. They fail on main.
- Size: run_action's Kiro `tool_load` text is 2,322 characters with `times` and `compareTo`, still under 0.1.0's 2,409 (D-140's test).
- Alternatives: a daemon endpoint that diffs (a protocol change for what the MCP server can do with two reads); diffing against the merged trace of an earlier `times` call (the daemon stores runs, not merges); a `compareTo` union type in the schema (about twice the schema text).
- Revert: drop `compareTo`, `MAX_DIFF_CHARS` and the diff branch in `server.ts`, the `max` parameters of `describeActionResult` and `summarizeTrace`, restore `INSTRUCTIONS`, the init block line, the four docs lines and the two pinned values, and drop the new tests.

### D-145 The void check stops flagging URL-form paths inside the trial and module paths written into files (amends D-108's scoring; Tier 2, scoring changed after results exist)

- Date: 2026-11-04 (written before the code change and before any re-score)
- Decision: `outsidePaths` in `bench/agent-suite/run.mjs` changes in two places, and nowhere else:
  1. A path in URL form is read as the drive path it names before it is resolved: `/c:/x` and `file:///c:/x` become `c:/x` (any drive letter, either slash). Today `resolve(trial, '/c:/Users/...')` gives `C:\c:\Users\...`, which is never inside the trial.
  2. A `..` path found inside a shell command's text counts only if the place it resolves to (against the call's `cwd`) exists on disk when the run is scored. Text that names nothing real outside the folder, such as a module path the command writes into a file (`require('../utils/...')`), is not a read.
  Unchanged: path fields and ACP `locations`, drive paths inside commands, a bare `..`, the 15-minute limit, the harness rules, and "a void run is rerun once". Each hit the new rules drop is kept in the run's `ignoredOutsidePaths` with its reason, so a person can still review it. `SCORING.md` says the same.
- Why: the 2026-11-03 benchmark (`bench/agent-suite/results/2026-11-03-full-benchmark.md`, "A flaw in the void check") found 5 runs voided on paths that were inside the trial or weren't paths: b06-with-2 and its rerun b06-with-4 (`/c:/Users/.../b06-with-2/server/routes/orders.ts`), h02-without-3 (`'../utils'` and `'../../utils'` inside a PowerShell command that writes a `require(...)` line), and h02-with-2 and its rerun h02-with-6 (`../../utils/attachment-utils`, the same kind). Every one of them passed its hidden check. The owner's round of 2026-11-04 asks for this fix first, with the D-entry before the code, and a re-score from saved data.
- Re-score: the 2026-11-01 and 2026-11-03 results are re-scored from their saved transcripts with `bench/agent-suite/rescore-d145.mjs`, with no agent, app or browser run. The script first re-runs the old check on each transcript and requires it to give the stored `outsidePaths` exactly, so the re-parse is proven to match the run. The report (`bench/agent-suite/results/2026-11-04-rescore-d145.md`) gives the old and new numbers side by side. The result files themselves are not edited.
- Limits: rule 2 checks the disk at scoring time. For a new run that is right after the run. For the old runs it is now, and the trial folders' parents still exist, so a sibling trial would still be found. A `..` that only leaves the folder after a `cd` inside the same command is resolved against the call's `cwd`, as before; if that lands on a place that doesn't exist, the new rule drops it where the old rule flagged it. Every dropped hit is listed, so such a case stays visible.
- Alternatives: drop `..` tokens only when they follow `require(`, `import(` or `from` (misses the h02-without-3 case, where the path sits inside a PowerShell sub-expression); stop scanning shell text for `..` at all (would miss a real `Get-Content ..\..\x`); leave the rule and keep reporting both numbers (the owner asked for the fix).
- Revert: restore the old `outsidePaths` (kept verbatim as `outsidePathsD108` in `bench/agent-suite/lib/outside.mjs` for the re-score), restore the `SCORING.md` void paragraph, and drop the re-score report and script.
