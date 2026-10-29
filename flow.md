# How code runs in Lightpath

This file follows execution through the code: where each program starts, which function calls which, and in what order. For why things are built this way, see [decisions.md](decisions.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Paths are relative to the repo root. `#name` means a private method on a class.

## 1. The processes and their entry points

Lightpath isn't one program. A normal session has up to five processes:

| Process                                                          | Entry point                                                                             | Started by                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| **CLI + daemon + browser collector** (one process)               | `packages/cli/src/bin.ts`                                                               | You, with `lightpath dev -- <command>`        |
| **Your dev command** (for example `node dev.mjs`, `npm run dev`) | your own script                                                                         | the CLI, with `spawn`                         |
| **Your Node backend**, with the agent inside it                  | `packages/node-agent/src/register.ts` (loaded before your code by `--import`)           | your dev command, inheriting `NODE_OPTIONS`   |
| **Your Python backend**, with the agent inside it                | `agents/python/src/lightpath_agent/wsgi.py` or `asgi.py` middleware                     | you, by adding the middleware                 |
| **Chrome**                                                       | the init script `HOOK_SOURCE` in `packages/browser/src/collector.ts` runs in every page | the browser collector, through Playwright     |
| **VS Code extension**                                            | `activate()` in `extensions/vscode/src/extension.ts`                                    | VS Code, when `.lightpath/daemon.json` exists |
| **MCP server**                                                   | `packages/cli/src/bin.ts` with `lightpath mcp`                                          | your coding agent                             |

How they talk:

```
                       ┌─────────────── CLI process (bin.ts) ───────────────┐
 Chrome  ◄──CDP──────► │ BrowserCollector ──ingestLocal()──► Correlator      │
                       │                                        │            │
 Node backend ─POST /v1/ingest─► daemon server.ts ──► Correlator ─► MemoryStore
 (agent)               │                                        │            │
 Python backend ─POST /v1/ingest─┘                              ▼            │
 (agent)               │                       store listeners: terminal print│
                       └──────────────────────────────┬───────────────────────┘
                                                      │ WebSocket /v1/client
                                    ┌─────────────────┴─────────────────┐
                              VS Code extension                    MCP server
```

## 2. Package dependency order

Builds and imports go in this order (`tsconfig.json` at the root lists them; `tsc -b` follows it):

```
protocol  ─►  core  ─►  daemon ─┐
   │                            ├─►  cli
   ├──────►  node-agent ────────┤
   ├──────►  browser (+ core) ──┤
   └──────►  mcp ───────────────┘
protocol + core  ─►  extensions/vscode   (bundled by esbuild, not tsc -b)
agents/python                            (no dependency on the TypeScript code)
```

- `protocol` has the message schemas and `DaemonClient`. Everything depends on it.
- `core` is pure logic with no I/O; the daemon and extension use it.
- `node-agent` imports `protocol` for types only, so it has no runtime dependencies.

## 3. `lightpath dev`: startup order

Starting point: `packages/cli/src/bin.ts`.

1. **`bin.ts`** calls `main(process.argv)` and sets the exit code from its result.
2. **`main()`** in `packages/cli/src/main.ts` builds the `cac` parser with three commands (`dev`, `mcp`, `doctor`), parses arguments, and runs the matching action. For `dev`, everything after `--` becomes `command`.
3. **`dev()`** in `packages/cli/src/dev.ts`:
   1. `nodeVersionProblem(process.version)` from `env.ts`: stop if Node is older than 22.12.
   2. **`startDaemon()`** in `packages/daemon/src/server.ts`:
      1. `newToken()` from `auth.ts`.
      2. Creates `MemoryStore` (`store.ts`) and `Correlator` (`correlator.ts`).
      3. Creates the HTTP server with `route()`, and a `WebSocketServer` in `noServer` mode for `/v1/client`.
      4. Listens on `127.0.0.1` on a free port.
      5. `writeDiscovery()` in `discovery.ts` writes `.lightpath/daemon.json` and `.lightpath/.gitignore`.
   3. Subscribes to the store: each finished trace is printed with `formatTrace()` from `format.ts`.
   4. `agentEnv()` from `env.ts` builds the child environment: `NODE_OPTIONS` gets `--import="<registerUrl>"` (from `packages/node-agent/src/index.ts`), plus `LIGHTPATH_URL`, `LIGHTPATH_TOKEN`, and `LIGHTPATH_ROOTS`.
   5. Spawns your command. On Windows it goes through the shell as one string from `toShellCommand()`.
   6. Pipes the child's output to your terminal and feeds it to `UrlWatcher` (`detect.ts`). The first local URL triggers `openBrowser(url)`.
   7. **`openBrowser()`**:
      1. `correlator.addDevServer(origin, webRoot)` so `http://localhost:5173/src/Cart.tsx` resolves to a file.
      2. Creates a `BrowserCollector` with `send` set to `ingestLocal()`, which calls `correlator.ingest('browser', message)` directly.
      3. **`collector.start()`** in `packages/browser/src/collector.ts`:
         1. `launchBrowser()` in `launch.ts`: tries Chrome, then Edge, then Playwright's Chromium.
         2. Opens a page and a CDP session. Listens for `Debugger.scriptParsed` (stores each script's URL and hash) and `Debugger.paused` (goes to `#onPaused`).
         3. `Debugger.enable`, `Profiler.enable`, `Profiler.startPreciseCoverage({ callCount: true, detailed: true })`.
         4. Sends a `hello` message.
         5. `page.addInitScript(HOOK_SOURCE)`, `page.route('**/*', #onRoute)`, and request listeners that feed `SettleTracker` (`settle.ts`).
         6. `page.goto(url)`.
   8. `waitForExit(child)`: forwards Ctrl+C to the child and waits.
4. **Shutdown**, when the child exits: unsubscribe, `collector.stop()` (closes the browser), `daemon.close()` (closes sockets and deletes the discovery file). The exit code is your command's.

## 4. Inside your Node backend

Starting point: Node loads `packages/node-agent/dist/register.js` before your code, because of `NODE_OPTIONS=--import=…`.

### 4.1 Startup (once per process)

1. **`register.ts`** calls `startAgent()` inside a try/catch.
2. **`startAgent()`** in `start.ts`:
   1. **`readConfig(env, argv)`** in `config.ts`. Stops quietly if `LIGHTPATH_URL` or `LIGHTPATH_TOKEN` is missing, if the URL isn't localhost, or if this process is a tool (npm, Vite, tsc…). That's why Vite's own process isn't instrumented.
   2. **`new InspectorSession()`** in `inspector.ts`: connects an in-process inspector session and listens for `Debugger.scriptParsed`.
   3. **`session.start()`**: `Debugger.enable`, `Debugger.setSkipAllPauses`, `Profiler.enable`, `Profiler.startPreciseCoverage`.
   4. **`new Transport(…)`** in `transport.ts` and **`new Agent(…)`** in `agent.ts`.
   5. Subscribes to the `http.server.request.start` and `http.server.response.finish` diagnostics channels, each wrapped in `guard()` so errors never reach your app.
   6. Queues a `hello` message and registers a `beforeExit` flush.
3. Node then runs your code (for example `examples/shop/server/index.ts`) as usual.

### 4.2 Each HTTP request

```
http.server.request.start ──► Agent.onRequestStart(req)
                                 ├─ (if no other request in flight) session.take() → #emit('background')
                                 ├─ read x-lightpath-trace header
                                 └─ remember the request; mark overlaps
        your route handler runs (express → routes/orders.ts → services/pricing.ts …)
http.server.response.finish ─► Agent.onResponseFinish(req, res)
                                 ├─ session.take()          ← exactly this request's code
                                 └─ #emit('action', coverage, …)
                                       ├─ #keep(): drop node:, node_modules, and the agent's own files
                                       ├─ #pushSources(): first time a workspace script appears,
                                       │     queue 'scripts' + 'source' (Debugger.getScriptSource);
                                       │     an external .map is read by readExternalSourceMap()
                                       │     (sourcemap-file.ts) and sent inline as a data: URL
                                       └─ queue 'delta' with traceId, request, coverage
Transport.send() ──► #schedule(50 ms, unref'd timer) ──► flush() ──► #nextBatch() ──► #post()
                     #nextBatch(): up to 200 messages and 7 MB; a single larger message is dropped
                     POST http://127.0.0.1:<port>/v1/ingest  { protocolVersion, agentId, messages }
```

`session.take()` is `Profiler.takePreciseCoverage`, which returns what ran since the last read and resets the counters.

## 5. One click in the browser

This is the main flow. Times are from the end-to-end test.

```
 you press the mouse
   │
   ▼
 page: HOOK_SOURCE's capture pointerdown listener (the first listener on window)
   ├─ window.__lightpathLast = describe(event.target)
   └─ debugger;                                         ── page pauses ──
   │
   ▼
 CDP Debugger.paused ──► collector #onPaused(scriptUrl)
   ├─ scriptUrl !== 'lightpath://hook.js' → #resume() and stop (an app `debugger;`)
   └─ else: settle.cancel() if a click is open; queue #click() on #clickChain
   │
   ▼
 #click()                                               ── still paused ──
   ├─ Promise.all([ #take(), #lastTarget() ])   ← background coverage + target description
   ├─ traceId = newTraceId()                    (core/src/ids.ts)
   ├─ #active = traceId                         ← before resuming, so requests get tagged
   ├─ settled = settle.begin()
   └─ #resume()                                         ── page runs again (≈5 ms paused) ──
   │
   ├─ #emit('background', …)  and  send traceStart { traceId, label: labelFor(target) }
   │
   ▼
 your click handler runs: Cart.tsx checkout() → api.ts placeOrder() → fetch('/api/orders')
   │
   ▼
 page.route → #onRoute(): shouldTag() (rules.ts) is true for same-origin fetch/XHR
   └─ adds header x-lightpath-trace: <traceId>
   │
   ▼
 Vite proxies /api to the Express server ──► section 4.2 runs in the Node backend,
                                              with this traceId, and POSTs its delta
   │
   ▼
 response arrives, React re-renders the cart; request listeners tell SettleTracker
   │
   ▼
 300 ms with no requests in flight (or 5 s) → `settled` resolves ('quiet' or 'timeout')
   ├─ #take()                                  ← the click's frontend code
   ├─ await #emit('action', …)                 ← sources first, then the delta
   └─ send traceEnd { traceId, settled }       ← only after the delta (D-030)
```

Every `send` here is `ingestLocal()` in `packages/cli/src/dev.ts`, so it goes straight to the correlator (section 6).

## 6. Inside the daemon

### 6.1 HTTP ingest (Node and Python agents)

`packages/daemon/src/server.ts`:

1. `http.createServer` callback → `route(req, res)`.
2. `GET /v1/health` returns `{ ok, protocolVersion }`.
3. `POST /v1/ingest`:
   1. `authorize()` in `auth.ts`: 403 if there's an `Origin` header, 401 if the token is wrong.
   2. `readBody()`: 413 above 8 MB.
   3. `JSON.parse`, then `IngestBatch.safeParse()` from `packages/protocol/src/messages.ts`: 400 if invalid.
   4. 426 if the protocol version doesn't match.
   5. For each message, `correlator.ingest(agentId, message)`.
   6. Replies 204.

### 6.2 The correlator

`packages/daemon/src/correlator.ts`, `ingest()` switches on `message.type`:

| Message              | What happens                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `hello`              | Records the agent's kind and pid                                                         |
| `scripts`            | Stores script info (URL, hash, inline source map) by script ID, per agent                |
| `source`             | Caches the script source by hash                                                         |
| `traceStart`         | Opens a browser trace, or merges into one a backend delta already opened                 |
| `delta` (background) | Ignored for now                                                                          |
| `delta` (action)     | `#onDelta()`, below                                                                      |
| `lines` (Python)     | `#onLines()`: each path through `resolveFile()`, then `#addFile()` with count 1 per line |
| `traceEnd`           | Sets `endedAt` and publishes                                                             |

`#onDelta()`:

1. `#pendingFor(traceId, …)` finds the open trace, reopens one from the store, or starts a backend-only trace.
2. For each script in the delta:
   1. Looks up its info and cached source. Without a source the script is counted as `no-source` and skipped.
   2. `decodeDataUrlSourceMap()` if the script has an inline map.
   3. **`mapScript()`** from `packages/core/src/pipeline.ts` (section 7).
   4. Drop counts go into the trace; files go through `#addFile()`, which merges with `mergeLineCounts()` (highest count wins).
3. Records the request (method, path, status, duration, overlapped).
4. `#publish()`: turns the line maps into sorted `FileHits` (lines with count 0 removed), sorts files by when they were first seen, and calls `store.put()`.

### 6.3 Store and listeners

`MemoryStore.put()` in `store.ts` keeps the newest 200 traces and calls every listener:

- the CLI's terminal printer from section 3 (prints only once `endedAt` is set);
- one listener per connected WebSocket client, which sends `{ type: 'trace', trace }`.

### 6.4 Client WebSocket

`server.on('upgrade')` checks the path is `/v1/client` and `authorize()` passes, then `onClient(ws)`:

1. Sends `welcome` with the workspace roots.
2. Subscribes the socket to the store.
3. Answers `listTraces` with `store.list()` and `getTrace` with `store.get()`.

## 7. The mapping pipeline

`mapScript()` in `packages/core/src/pipeline.ts`, called once per script per delta:

```
resolveFile(script url)          resolve.ts      drop node_modules / internal early
        │
flattenRanges(functions)         flatten.ts      nested V8 ranges → flat segments (innermost wins)
        │
new LineIndex(source)            line-index.ts   line starts + non-whitespace bounds per line
        │
  ┌─────┴──────────────── has an inline source map? ────────────────┐
  │ no                                                               │ yes
rangesToLines(segments, index)   lines.ts       mapToOriginal(segments, index, map)   sourcemap.ts
  │  line → max count                                eachMapping → countAt(segment) → original line
  │                                                  │
  │                                            resolveFile(each original source)    resolve.ts
  └──────────────────────────┬───────────────────────┘
                             ▼
              { files: path → LineCounts, dropped: reason → count }
```

- Plain JS and Node type-stripped `.ts` take the left branch: the code V8 ran has the same positions as the file.
- Vite-served `.tsx` takes the right branch through Vite's inline source maps.

## 8. VS Code extension

Starting point: `activate()` in `extensions/vscode/src/extension.ts`. VS Code calls it when the workspace contains `.lightpath/daemon.json`.

1. Creates `Heat` (`decorations.ts`: 8 decoration types plus one for hit counts), `TraceTree` (`tree.ts`), and a status bar item.
2. Registers commands: `showTrace`, `openFile`, `replay`, `clear`, `toggleLive`, `togglePin`.
3. **`connect()`**:
   1. Reads `.lightpath/daemon.json` and validates it with `DaemonDiscovery`.
   2. `DaemonClient.connect(port, token)` (`packages/protocol/src/client.ts`) opens the WebSocket and waits for `welcome`; keeps `workspaceRoots`.
   3. Loads the last 20 traces with `listTraces()` and `getTrace()` into the tree.
   4. `onTrace`: each new trace goes into the tree; if live and finished, `show(trace)`.
   5. `onClose` (or any failure): status shows "waiting", and `scheduleRetry()` tries again in 2 s.
4. **`show(trace)` → `heat.show(trace, absolute)`**:
   1. Maps each workspace-relative path to an absolute path (first workspace root), keyed by `pathKey()` (`heat.ts`).
   2. `refresh()` → `#apply(editor)` for each visible editor: `bucketize(lines)` from `heat.ts`, then one `setDecorations` per heat level, plus `× N` labels. `#apply` also records which lines it drew, per file, for `drawnLines()`.
   3. `#startFade()`: every `fadeSeconds / 4`, lines move down two heat levels; after 4 steps, `clear()`.
5. **Replay**: walks `replayOrder(trace)` (by `firstSeenAt`), opens each file, `heat.showFile()`, waits 600 ms.
6. Switching editors calls `heat.refresh()` so newly visible files light up.
7. `activate()` returns a read-only `LightpathApi` (`isConnected`, `traceIds`, `drawnLines`), reachable as `vscode.extensions.getExtension('lightpath-dev.lightpath-vscode').exports`.

**In-editor test** (`pnpm test:vscode` → `extensions/vscode/test/editor/run.mjs`), in order:

1. Starts the daemon for `examples/shop` (writing `.lightpath/daemon.json`), the shop with the Node agent, and a headless `BrowserCollector`.
2. Opens a control server with one endpoint, `POST /click`: presses "Add to cart", then "Checkout", and replies with the finished Checkout trace.
3. `runTests()` from `@vscode/test-electron` downloads VS Code into `extensions/vscode/.vscode-test/` and starts it on the shop folder with a temp profile, only this extension, and `test/editor/suite.cjs`.
4. Inside VS Code, `suite.cjs` waits for the activation event and the connection, opens `Cart.tsx` and `orders.ts` side by side, runs `togglePin`, calls `/click`, and checks that `drawnLines()` equals the trace's lines and heat levels for both files. Then it runs `clear` and checks nothing is drawn.
5. The runner stops Chrome, the shop, and the daemon (which removes the discovery file), and deletes the temp profile.

## 9. MCP server

Starting point: `packages/cli/src/bin.ts` with `lightpath mcp`.

1. `main()` → the `mcp` action → `runMcpServer({ workspaceRoot })` in `packages/mcp/src/server.ts`.
2. `createMcpServer()` registers four tools with `server.registerTool()`, then connects a `StdioServerTransport`. From now on stdout carries MCP messages only.
3. When an agent calls a tool:
   1. `withClient()` → `connect()` reads `.lightpath/daemon.json` and opens a `DaemonClient`.
   2. The tool runs, for example `find_code_for_action`: `listTraces({ label })`, then `getTrace(id)`.
   3. Output is formatted with `describeTrace()`, `describeSummaries()`, or `diffTraces()` from `format.ts`.
   4. The client is closed.

## 10. Inside your Python backend

Starting point: your WSGI or ASGI app is wrapped in `LightpathMiddleware` (`wsgi.py`) or `LightpathASGIMiddleware` (`asgi.py`).

### 10.1 First request (startup)

1. The middleware's `__call__` calls `get_agent()` in `__init__.py`.
2. `get_agent()` runs `_start()` once, under a lock:
   1. `read_config()` in `config.py`: returns nothing if not launched by Lightpath or the URL isn't localhost.
   2. `Recorder(roots).start()` in `recorder.py`: claims tool ID 3 or 4, registers `_on_line` for `LINE` events.
   3. `Transport(...)` in `transport.py` starts its background thread.
   4. `Agent.hello()` in `agent.py` queues a `hello`; `atexit` will flush.
3. If there's no agent, the middleware just calls your app.

### 10.2 Each request

```
middleware __call__
  ├─ agent.begin(trace header, method, path)
  │     └─ recorder.begin(): new Recording, overlap marking, sys.monitoring.restart_events()
  ├─ your app runs; for every project line, first time this request:
  │     recorder._on_line(code, line) → append (file, line) → return DISABLE
  ├─ WSGI: body is wrapped in _ClosingIterable; when the server calls close():
  │  ASGI: in the finally block after the app returns
  └─ agent.finish(pending, status)
        ├─ recorder.end(recording)
        ├─ recording.files(): group by file, first-hit order, no repeats
        └─ transport.send({ type: 'lines', … })  → background thread POSTs /v1/ingest
```

The daemon handles it in `#onLines()` (section 6.2).

## 11. Commands: what runs, in order

| Command                        | Order                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                   | `tsc -b` → `protocol`, `core`, `daemon`, `node-agent`, `browser`, `mcp`, `cli`, each into its `dist/`                  |
| `pnpm typecheck`               | `pnpm build`, then each package's `typecheck` (`tsc -p test`; the extension also checks `src`; the shop checks itself) |
| `pnpm lint`                    | `biome check .`                                                                                                        |
| `pnpm test`                    | `vitest run` in every package that has a `test` script                                                                 |
| `pnpm test:py`                 | `python -m unittest discover` in `agents/python/tests`                                                                 |
| `pnpm check`                   | `typecheck` → `lint` → `test` → `test:py` (what CI runs)                                                               |
| `pnpm bundle`                  | `node esbuild.mjs` in the extension → `extensions/vscode/dist/extension.cjs`                                           |
| `pnpm e2e`                     | `pnpm build`, then `scripts/e2e-shop.mjs` (below)                                                                      |
| `pnpm e2e:api`                 | `pnpm build`, then `scripts/e2e-api.mjs` (below)                                                                       |
| `pnpm test:vscode`             | `pnpm build`, `pnpm bundle`, then `extensions/vscode/test/editor/run.mjs` (section 8)                                  |
| `pnpm --filter shop lightpath` | `node packages/cli/dist/bin.js dev -- node dev.mjs` in the shop folder                                                 |

`scripts/e2e-shop.mjs`, in order:

1. Imports the built `daemon`, `browser`, `node-agent`, and `cli` packages from `dist/`.
2. `startDaemon()` without a discovery file; subscribes to traces.
3. Spawns `examples/shop/dev.mjs` with `agentEnv()`. `dev.mjs` starts `server/index.ts` (with the agent) and Vite (skipped by the agent).
4. Waits for Vite's URL with `UrlWatcher`, then `addDevServer()`.
5. Starts a headless `BrowserCollector`; waits for the product list.
6. Presses "Add to cart" (press, hold 80 ms, release), waits for its trace, checks it.
7. Presses "Checkout", waits for "Order #… placed", waits for a trace that has Node files, checks files, the request, a dark line, and a lit line.
8. Stops the browser, kills the shop's process tree, closes the daemon, exits 0 or 1.

`scripts/e2e-api.mjs`, in order:

1. Resolves tsx's CLI from the shop's dependencies, like `npx tsx` would, and builds the API with `tsc -p tsconfig.server.json` into `examples/shop/dist/server` (JavaScript plus `.map` files).
2. For each way of starting the shop's API (`node server/index.ts`, `tsx server/index.ts`, `tsx watch server/index.ts`, `node dist/server/index.js`): spawns `packages/cli/dist/bin.js dev --no-browser --debug -- <command>` in `examples/shop`, so the CLI starts the daemon and sets `NODE_OPTIONS` exactly as for a user.
3. Waits for "listening on port", reads `.lightpath/daemon.json` (checking its `pid` is this CLI), and connects a `DaemonClient`.
4. POSTs one order to `http://127.0.0.1:3001/api/orders`, then polls `listTraces()` and `getTrace()` until a finished trace contains `server/routes/orders.ts`.
5. Checks the request, the files, a dark and a lit line, that nothing was dropped for a missing source or map, that the terminal printed the route, and (for tsx) that the agent skipped tsx's own CLI process.
6. Stops the process tree, removes the discovery file, and waits for port 3001 to be free.
7. Compares every file's lines and counts from the tsx and tsc runs with the type-stripping run, which has no source map and so is the reference.

`packages/core/scripts/capture-fixtures.mjs` (run by hand when a sample changes), in order:

1. For each sample in `packages/core/test/fixtures/samples/`, spawns a child Node process running the same script with `--child <file>`. The `tsx` sample's child also gets `--import tsx`.
2. In the child: opens an in-process inspector session, enables `Debugger` (to receive `scriptParsed`) and precise coverage, imports the sample, takes and discards the load-time coverage, awaits `run()`, takes the delta, reads the script source with `Debugger.getScriptSource`, and prints JSON.
3. Back in the parent: `portable()` decodes the inline source map, swaps this machine's paths for `file:///repo/samples`, and cuts the trailing `//# sourceMappingURL` comment.
4. Writes `<name>.json` with the sample's SHA-256. `test/fixtures.test.ts` runs each fixture through `mapScript()` and compares against hand-checked lines; it doesn't regenerate them.
5. Then `captureViteJsx()`: spawns `examples/shop/dev.mjs` (without Lightpath), waits for `http://localhost:5173`, launches Chrome through `playwright-core` from the browser package, and opens a CDP session with `Debugger` and precise coverage on. It loads the page, adds an item, takes and discards that coverage, clicks Checkout, waits for "Order #… placed", and takes the delta.
6. Saves `/src/Cart.tsx` as Vite served it with its inline map. `redactSameLength()` replaces the absolute path that Vite's React transform writes into `_jsxFileName` with a placeholder of equal length, so no offset moves. Then it kills the shop's process tree.

## 12. Where to start reading

1. `packages/core/src/flatten.ts` and `lines.ts`: the core idea in about 150 lines.
2. `packages/node-agent/src/agent.ts`: how a request becomes a delta.
3. `packages/browser/src/collector.ts`: `HOOK_SOURCE`, `#onPaused`, and `#click`.
4. `packages/daemon/src/correlator.ts`: how everything meets.
5. `packages/cli/src/dev.ts`: how the pieces are wired together.
