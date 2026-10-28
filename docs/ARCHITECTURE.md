# Lightpath architecture

Lightpath shows which lines of code ran for one user action. You click a button in your running app, and every frontend and backend line that ran for that click lights up in your editor, brighter the more times it ran.

This document describes the system as designed. Facts marked **(measured)** come from spikes run on Node 24.13 and Python 3.13.5 on Windows on October 28, 2026. Facts marked **(unverified)** are design assumptions that a milestone in [ROADMAP.md](ROADMAP.md) must confirm before code depends on them.

## 1. Goals and non-goals

### Goals

1. **Line-level, per-action.** One click produces one trace: the set of original source lines that ran, with hit counts, across the browser and every backend process the click reached.
2. **No code changes in the user's app.** One command (`lightpath dev -- npm run dev`) instruments everything.
3. **Correct before fast before pretty.** A wrong highlighted line destroys trust faster than a slow one. Every mapping step has fixture tests.
4. **Cheap when idle.** No polling. Work happens only at action boundaries.
5. **Local and private.** Nothing leaves the machine. The daemon listens on loopback only and requires a token.
6. **Agent-friendly.** Coding agents can ask "which code handles Checkout?" through MCP and get real runtime answers.

### Non-goals for v0

| Not in v0                                              | Why                                                                       | Revisit                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------- |
| Firefox and Safari                                     | Precise coverage is a Chrome DevTools Protocol feature                    | Never for Safari; Firefox if it gains an equivalent |
| Next.js server components and multi-process frameworks | Server rendering spans processes and workers that need per-framework work | After launch, as a framework adapter                |
| Worker threads and web workers                         | Each has its own V8 isolate and needs its own session                     | v0.3                                                |
| Exact line order inside one script                     | V8 coverage gives counts, not timestamps                                  | Python gives first-hit order already                |
| Production use                                         | Precise coverage disables optimized code                                  | Never; this is a dev tool                           |
| Per-request isolation under concurrent load            | Coverage is per isolate, not per request (see section 6.3)                | Documented limitation                               |

## 2. Components

```
                         ┌─────────────────────────── your machine ───────────────────────────┐
                         │                                                                   │
  Chrome (Playwright)    │   Node backend(s)                      Python backend              │
  ┌──────────────────┐   │   ┌────────────────────────┐          ┌──────────────────────┐    │
  │ @lightpath/browser│   │   │ @lightpath/node-agent  │          │ lightpath-agent (py) │    │
  │ CDP session:      │   │   │ --import register      │          │ sys.monitoring LINE  │    │
  │  Profiler (cov)   │   │   │ node:inspector Session │          │ WSGI/ASGI middleware │    │
  │  Debugger (maps)  │   │   │ diagnostics_channel    │          └──────────┬───────────┘    │
  │  click boundary   │   │   └───────────┬────────────┘                     │ HTTP POST      │
  │  page.route header│   │               │ HTTP POST /v1/ingest             │ /v1/ingest     │
  └────────┬─────────┘   │               │                                  │                │
           │ in-process  │               ▼                                  ▼                │
           └────────────────────►  @lightpath/daemon  (127.0.0.1, random port, token)        │
                         │         ├─ ingest + correlation (trace id, time windows)           │
                         │         ├─ @lightpath/core: ranges → lines → source maps → files   │
                         │         ├─ Store (memory ring buffer; SQLite later)                │
                         │         └─ WebSocket feed for clients                              │
                         │                 │                       │                          │
                         │                 ▼                       ▼                          │
                         │      VS Code extension         lightpath mcp (stdio)               │
                         │      heat decorations,         tools for coding agents             │
                         │      trace list, replay                                            │
                         │                                                                    │
                         │      lightpath CLI: starts daemon + browser, spawns `npm run dev`  │
                         │      with NODE_OPTIONS=--import=<agent>, prints each click's path  │
                         └────────────────────────────────────────────────────────────────────┘
```

| Package                 | Path                  | Role                                                                                                      | Runtime deps                      |
| ----------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `@lightpath/protocol`   | `packages/protocol`   | Wire message types and zod schemas, protocol version                                                      | zod                               |
| `@lightpath/core`       | `packages/core`       | Pure logic: range flattening, offset→line, source maps, path resolution, noise rules, trace model. No I/O | @jridgewell/trace-mapping         |
| `@lightpath/daemon`     | `packages/daemon`     | HTTP ingest, client WebSocket feed, auth, correlation, store                                              | ws, core, protocol                |
| `@lightpath/node-agent` | `packages/node-agent` | Runs inside the user's Node process. Coverage, script capture, HTTP boundaries                            | none (uses Node built-ins only)   |
| `@lightpath/browser`    | `packages/browser`    | Launches Chrome, marks click boundaries, collects frontend coverage, tags requests                        | playwright-core, core, protocol   |
| `@lightpath/mcp`        | `packages/mcp`        | MCP server over stdio that queries the daemon                                                             | @modelcontextprotocol/sdk, zod    |
| `@lightpath/cli`        | `packages/cli`        | `lightpath dev`, `lightpath mcp`, `lightpath doctor`; terminal output                                     | cac, picocolors, all of the above |
| `lightpath-vscode`      | `extensions/vscode`   | Decorations, gutter counts, trace tree, replay                                                            | ws (bundled)                      |
| `lightpath-agent`       | `agents/python`       | Python agent (PyPI)                                                                                       | none (standard library only)      |
| example                 | `examples/shop`       | Vite + React frontend, Node HTTP API with type-stripped TypeScript                                        | react, vite, express              |

Two rules keep the dependency graph clean:

- `core` and `protocol` never import Node APIs, so they can run in the extension, the daemon, and tests unchanged.
- The Node agent has **zero npm dependencies**. It loads inside the user's process, so anything it imports can clash with the app's own versions or slow its startup.

## 3. The life of one click

This is the path the system is built around. Times are targets, not measurements.

1. **Pointer down.** The user presses the mouse on "Checkout". The collector's init script owns the first capture `pointerdown` listener on `window`; it records the target and runs `debugger;` (ADR 0003). Chrome pauses the page before any app handler runs.
2. **Open the trace.** While the page is paused, the collector calls `Profiler.takePreciseCoverage` and files the result as _background_ (timers, animation frames since the last take). It creates trace `t_42` with the target's label ("button: Checkout") and resumes the page. Measured pause: 4.7 to 7.1 ms. Chrome drops `pointerup` and `click` events that arrive while the page is paused, so the pause must stay well under a human press (50 to 150 ms).
3. **Tag requests.** For the next request window, `page.route` adds `x-lightpath-trace: t_42` to requests sent to the configured backend origins (ADR 0004). Cross-origin requests to other hosts are left untouched so no CORS preflight is triggered.
4. **Backend boundary.** In the Node API process, `http.server.request.start` fires before the route handler **(measured)**. The agent reads the header, takes coverage (filed as background for that process), and records the request start.
5. **Handler runs.** Express routes, services, and the database client run.
6. **Backend close.** `http.server.response.finish` fires after the response is written **(measured)**. The agent takes coverage again. That delta is the request's code. It sends `{traceId: t_42, delta, timing}` to the daemon.
7. **Settle.** The collector waits until the page has no in-flight requests and 300 ms of quiet have passed (capped at 5 s, configurable), then takes coverage again. That delta is the click's frontend code: the handler, state updates, and the re-render.
8. **Map.** The daemon passes each delta through `core`: flatten nested ranges, convert offsets to generated lines, map through source maps, resolve to workspace files, apply noise rules. The output is `FileHits`: `file → line → count`.
9. **Publish.** The trace is stored and pushed to clients. The VS Code extension lights up `Cart.tsx`, `api.ts`, `routes/orders.ts`, and `payment.ts`. The CLI prints a summary. The MCP tool can now answer questions about `t_42`.


## 4. The mapping pipeline (`@lightpath/core`)

Every coverage source, browser or Node, goes through the same pure pipeline. Each stage is a function with fixture tests.

```
ScriptCoverage[] ──► flattenRanges ──► rangesToLines ──► mapToOriginal ──► resolveFile ──► filterNoise ──► FileHits
   (V8 delta)         per script        generated          source map        workspace       node_modules,
                      innermost wins    line → count       original line     path or drop    framework, idle
```

### 4.1 What a V8 delta contains (measured)

- `takePreciseCoverage` returns only functions that ran since the previous take, plus, for each function that ran, its nested functions and blocks with `count: 0` when they didn't run. Example from the spike: `outer [299-490]x1 [454-489]x0`, `unusedCb [341-377]x0`.
- Ranges nest. A function's first range covers the whole function. Later ranges are blocks inside it with their own counts.
- Counts reset on every take. Docs: "Collect coverage data for the current isolate, and resets execution counters."
- In-process, the take itself shows up in the next delta (the agent's own `post` function). The agent drops its own script URL.

### 4.2 `flattenRanges`: innermost range wins

Input: one script's functions. Output: a sorted list of non-overlapping `[start, end, count]` segments.

Algorithm: collect all ranges, sort by `start` ascending then `end` descending (outer before inner), and sweep with a stack. When a range starts, it overrides the count of its parent for its span. When it ends, the parent's count resumes. This is O(n log n) for n ranges and produces the count of the innermost range at every byte. It's the same rule `c8` and `v8-to-istanbul` use.

### 4.3 `rangesToLines`: offsets to generated lines

- Build a line-start index for the generated source once per script (`Uint32Array` of offsets of each `\n` + 1). Cache it by script hash.
- A line's count is the **maximum** count of any segment that overlaps a non-whitespace character on that line. Maximum, not sum: a loop body that ran 10 times on one line shows 10, not 10 plus its condition's 11.
- A line is _covered_ if its count is above 0. A line that only touches segments with count 0 is _uncovered_. Lines with no segment are _unknown_ and render with no color.
- V8 offsets are UTF-16 code unit indexes, the same as JavaScript string indexes. Never index into a UTF-8 buffer **(unverified for non-ASCII sources; add a fixture with emoji and CJK identifiers)**.

### 4.4 `mapToOriginal`: generated lines to original lines

- Use `@jridgewell/trace-mapping` (`originalPositionFor`). It's what Vite, Vitest, and c8 use.
- Map each covered **segment** start and end rather than each line, then fill the original lines between them. Mapping only line starts misses code that moved during transpiling.
- Where several generated lines map to one original line, keep the maximum count.
- Unmapped generated lines (helpers the compiler added, such as JSX runtime imports or HMR glue) are dropped. They aren't user code.

Where the source map comes from:

| Source                                        | How the map is found                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite dev server (browser)                     | `Debugger.scriptParsed` gives `sourceMapURL`. Vite 8.3 serves inline `data:` maps for transformed modules, and they map `.tsx` lines correctly **(measured in the golden end-to-end test)** |
| Node with type stripping (`.ts` run directly) | No map needed. Types are replaced with whitespace, so offsets match the original file                                                                                                       |
| Node with `tsx` or another loader             | In-process `Debugger.scriptParsed` gives `sourceMapURL` (inline `data:` URL) **(measured on a data URL module)**                                                                            |
| Plain `.js`                                   | Identity mapping                                                                                                                                                                            |

### 4.5 `resolveFile`: URLs to workspace paths

| URL form                                          | Resolution                                                |
| ------------------------------------------------- | --------------------------------------------------------- |
| `file:///C:/repo/src/a.ts`                        | `fileURLToPath`, then case-normalize on Windows           |
| `http://localhost:5173/src/Cart.tsx?t=1730000000` | Strip the query, map the path under the dev server's root |
| `http://localhost:5173/@fs/C:/repo/x.ts`          | Vite's `/@fs/` prefix is an absolute path                 |
| `/node_modules/.vite/deps/react.js`               | Dropped (dependency)                                      |
| `node:internal/...`                               | Dropped                                                   |
| Source map `sources` entries                      | Resolved against `sourceRoot`, then the map's own URL     |

A file is shown only if the resolved path is inside a workspace root. Everything else is counted in a `dropped` tally so `lightpath doctor` can explain missing files.

### 4.6 `filterNoise`

Three rules, applied in order:

1. **Path rules.** Drop `node_modules`, Vite's `/@vite/client`, `/@react-refresh`, and the agent's own scripts. Users can add globs in `lightpath.config.json`.
2. **Background subtraction.** Each collector keeps the set of functions that appeared in background deltas recently (timers, `requestAnimationFrame`, HMR pings). A function seen only in background windows and never in an action window is tagged `background` instead of being dropped, so the UI can hide it by default.
3. **Count floor.** None in v0. Every line that ran is shown.

### 4.7 Identity and caching

- A script is identified by `(sourceUrl, hash)`. `Debugger.scriptParsed` provides `hash`. Hot reload produces a new hash, so stale maps are never reused.
- Line indexes and parsed source maps are cached per identity in an LRU (default 500 scripts).


## 5. Collectors

### 5.1 Browser collector (`@lightpath/browser`)

- Launch with `playwright-core` using the installed Chrome (`channel: 'chrome'`) so users don't download a browser. Fall back to Edge (`msedge`), then to a Playwright-managed Chromium if the user installed one.
- One CDP session per page via `context.newCDPSession(page)`. Enable `Profiler` and `Debugger`. Pauses stay enabled: the hook's `debugger;` is the boundary, and any other pause is resumed at once.
- Start coverage with `{ callCount: true, detailed: true }`. Detailed (block) coverage is required for line-level results. Starting coverage disables optimized code, so the page runs slower; the docs say so ("Enabling prevents running optimized code").
- **Click boundary**: an init script registers the first capture `pointerdown` listener, stores the target's description (role, accessible name, `data-testid`, text), and runs `debugger;` (ADR 0003). The paused frame is identified by resolving its `scriptId` to `lightpath://hook.js`, because `CallFrame.url` is empty for init scripts **(measured)**. Keyboard activation (`keydown` Enter and Space) is an M3 task.
- **Settle rule**: zero in-flight requests and 300 ms without new requests or long tasks, capped at 5 s.
- **Navigations**: a full page load resets scripts. Coverage keeps running because the session belongs to the target, but script IDs change, so the collector re-reads `scriptParsed`.

### 5.2 Node agent (`@lightpath/node-agent`)

Loaded with `NODE_OPTIONS=--import=<file URL of register.js>`. On Windows the path **must** be a `file://` URL; a raw `C:\...` path fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` **(measured)**. Quoted URLs with `%20` for spaces work **(measured)**.

What it does at startup, in order:

1. Exit quietly unless `LIGHTPATH_URL` and `LIGHTPATH_TOKEN` are set, so a stray `NODE_OPTIONS` never breaks a process.
2. Skip processes that aren't the app: the package manager, Vite's own dev server process, and build tools, matched on `process.argv` against `LIGHTPATH_SKIP`.
3. Open an in-process `inspector.Session` and `connect()`. `post` callbacks run **synchronously** in-process **(measured)**, so a take is a plain function call with no await.
4. `Debugger.enable` + `Debugger.setSkipAllPauses({ skip: true })` to receive `scriptParsed` (URLs, hashes, source map URLs). A `debugger;` statement in user code doesn't pause **(measured)**. Enabling replays already-parsed scripts (110 in the spike) **(measured)**.
5. `Profiler.enable` + `startPreciseCoverage({ callCount: true, detailed: true })`.
6. Subscribe to `http.server.request.start` and `http.server.response.finish` (fire before and after the handler) **(measured)**.
7. Queue messages and send them to the daemon as `IngestBatch` HTTP POSTs (ADR 0006). The send timer is `unref()`ed so it never keeps the process alive. Up to 1,000 messages are queued while the daemon is unreachable, then the oldest are dropped.

Per request: take at start (background), take at finish (the request), attach the trace ID from `x-lightpath-trace` if present, and queue the delta. The first time a script appears in a delta, the agent also queues its source (`Debugger.getScriptSource`), once per hash, filtered to workspace files so `node_modules` sources are never sent.

**Cost (measured).** A take costs time in proportion to all compiled functions in the isolate, not just those that ran: about 0.75 ms with 1,000 functions, 5 ms with 10,000, and 28 ms with 50,000. So the agent takes only at request boundaries and never polls. A large Express app is likely in the 10,000 to 50,000 range, adding 10 to 60 ms per request in dev. Budgets are in section 8.

### 5.3 Python agent (`lightpath-agent`)

- `sys.monitoring` (PEP 669, Python 3.12+). Claim a free tool ID (prefer one that isn't `DEBUGGER_ID` so real debuggers still work).
- `LINE` callback records `(file, line)` for files inside the project and returns `DISABLE`, so each line costs one callback per action. Files outside the project return `DISABLE` immediately.
- `restart_events()` at the start of each request re-arms every disabled location **(measured)**. That gives first-hit order, which V8 can't. It doesn't give counts, so Python lines render with count 1.
- `restart_events()` is global to the interpreter and affects other tools' disabled events too. Documented; debuggers using `sys.monitoring` may see extra events.
- Overhead with events on and every location disabled: a CPU-bound loop went from 45.8 ms to 57.7 ms **(measured, one run)**. Needs a proper benchmark in M6.
- Integration: WSGI and ASGI middleware (Flask, Django, FastAPI) read `x-lightpath-trace`, wrap the request, and POST the result to the daemon. Standard library only.

## 6. Correlation

### 6.1 Trace IDs

The browser collector creates the trace and tags backend requests with `x-lightpath-trace`. Backends attach their deltas to that ID. Untagged requests (curl, a second tab, a webhook) become their own traces with `origin: "backend"`.

### 6.2 Request tagging rules (ADR 0004)

- Tag only requests whose origin is in `backendOrigins` (default: the dev server origin, because Vite proxies `/api` to the backend, plus any origin the user configures).
- Never add the header to other origins. A custom header on a cross-origin request triggers a CORS preflight that would change the app's behavior.
- Server-to-server calls (Node `fetch` to another local service) carry the header forward through `http.client.request.start` and `undici:request:create` **(both channels measured; header injection unverified)**.

### 6.3 Concurrency (known limitation)

V8 coverage counts per isolate, not per request. If two requests overlap in one Node process, each request's delta contains lines from both. v0 handles this honestly:

- The agent tracks in-flight requests. A delta taken while more than one request was in flight is marked `overlapped: true` with the other trace IDs.
- The UI shows an "overlapping requests" badge on those traces.
- In practice a developer clicking through their app produces one request at a time. Load tests are out of scope.

A per-request fix would need V8 to attribute counts to async contexts. It doesn't, so there is no fix planned.


## 7. Daemon (`@lightpath/daemon`)

### 7.1 Responsibilities

- Accept agent connections (WebSocket `/v1/agent`) and Python ingest (`POST /v1/ingest`).
- Accept client connections (WebSocket `/v1/client`) from the VS Code extension, the CLI, and the MCP server.
- Request script sources from agents on demand, run the `core` pipeline, store traces, and publish them.
- Write a discovery file so clients can find it: `<workspace>/.lightpath/daemon.json` with `{ port, token, pid, protocolVersion, startedAt }`. The file is git-ignored via a generated `.lightpath/.gitignore`.

### 7.2 Security

The daemon receives source code and can see request paths, so it must not be reachable by other machines or by web pages.

| Threat                                                                                   | Defense                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another machine connects                                                                 | Bind to `127.0.0.1` only, never `0.0.0.0`                                                                                                                                                                                                                   |
| A malicious web page sends requests to `http://127.0.0.1:<port>` from the user's browser | Require a 32-byte random token on every request and client connection (constant-time comparison); reject any request or WebSocket with an `Origin` header, since agents and the extension don't send one; no CORS headers, so browsers can't read responses |
| Another local user reads the token                                                       | `daemon.json` is created with user-only permissions (mode 0600 on Unix; inherited user ACL in the workspace on Windows)                                                                                                                                     |
| Oversized or malformed messages                                                          | Validate every batch with the zod schemas in `protocol`; cap request bodies at 8 MB; reply 400 on schema failure (ingest) or close with 4400 (client WebSocket)                                                                                             |
| Path traversal when a client asks for a file                                             | The daemon never reads files for clients. It returns workspace-relative paths; the extension opens them itself                                                                                                                                              |

### 7.3 Store

- `Store` interface with `put(trace)`, `get(id)`, `list(query)`, `subscribe(fn)`.
- v0: `MemoryStore`, a ring buffer of the last 200 traces (configurable).
- Later: `SqliteStore` with `node:sqlite`. On Node 24.13 it still prints `ExperimentalWarning` **(measured)**, so it waits until it's stable or behind an opt-in flag.

## 8. Performance budgets

| Operation                         | Budget                                    | Notes                                                              |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| Page paused at the click boundary | < 10 ms p95                               | One take plus a label lookup                                       |
| Node take per request boundary    | < 30 ms p95 for 50,000 compiled functions | Measured 28 ms in the spike; two takes per request                 |
| Daemon mapping per trace          | < 50 ms for 200 scripts                   | Line index and maps cached by hash                                 |
| Click to editor glow              | < 500 ms after the settle window          | Settle window itself is 300 ms by default                          |
| Extension decoration update       | < 16 ms per visible editor                | Decorations grouped into 8 heat buckets (one decoration type each) |
| Idle CPU of the agent             | ~0                                        | No timers, no polling                                              |

Benchmarks live in `bench/` and run in CI on every release. Numbers in the README come from there, not from this table.

## 9. Clients

### 9.1 VS Code extension

- Reads `.lightpath/daemon.json` and connects as a client.
- **Heat**: 8 `TextEditorDecorationType`s, one per bucket of `log2(count)`, created once. Updating a file calls `setDecorations` once per bucket. Creating a decoration type per line would be slow and leak.
- **Gutter**: hit count shown with `after` text on the line (`× 12`), hidden by default for count 1.
- **Fade**: decorations dim over 10 s by switching buckets, then clear. A pinned trace stays lit.
- **Trace list**: a tree view of recent traces (label, duration, files, overlapped badge). Selecting one opens its files.
- **Replay**: re-applies a trace file by file in the order the collectors saw them (browser, then each backend by request start), 300 ms apart.
- **Compare**: two traces, showing lines only in A, only in B, and in both.

### 9.2 CLI

`lightpath dev -- <command>` is the main entry point. It starts the daemon, spawns `<command>` with `NODE_OPTIONS` extended (never replaced), waits for the dev server URL (from `--url` or by reading the child's output for `http://localhost:<port>`), opens Chrome on it, and prints each trace as a tree of files and line ranges.

### 9.3 MCP server

`lightpath mcp` runs an MCP server over stdio. It reads the discovery file and talks to the daemon as a client.

| Tool                   | Input                        | Output                                       |
| ---------------------- | ---------------------------- | -------------------------------------------- |
| `list_traces`          | optional label filter, limit | id, label, time, file count                  |
| `get_trace`            | trace id                     | files with line ranges and counts            |
| `find_code_for_action` | text, e.g. "Checkout"        | best-matching trace by label, with its files |
| `diff_traces`          | two trace ids                | lines only in each                           |

## 10. Failure modes

| Failure                                              | Behavior                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Daemon not running when an agent starts              | Agent buffers, retries with backoff for 30 s, then disables itself and logs one line                |
| Source map missing or broken                         | Lines map to the generated file if it's in the workspace; otherwise dropped and counted in `doctor` |
| Script source changed (HMR) between take and mapping | Mapping uses the source fetched by hash, never the file on disk                                     |
| Chrome not installed                                 | Clear error naming the `channel` options tried and how to install Chromium through Playwright       |
| User's `NODE_OPTIONS` already has `--import`         | Append ours; never replace theirs                                                                   |
| Agent throws                                         | Every agent entry point catches and logs; the user's process must never crash because of Lightpath  |

## 11. Testing strategy

| Layer        | Tests                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`       | Unit tests with fixtures: real V8 deltas captured from the example app, checked against hand-verified expected lines. Property test: flattening never produces overlapping segments |
| `protocol`   | Every message type round-trips through its schema; invalid messages are rejected                                                                                                    |
| `node-agent` | Integration: start a child process with the agent and a tiny HTTP server, send a request, assert the handler's lines arrive at a fake daemon                                        |
| `browser`    | Integration (opt-in locally, nightly in CI): drive the example shop with Playwright and assert `Cart.tsx` lines appear for the checkout click                                       |
| End to end   | `examples/shop` + `lightpath dev`: the golden test that the demo works                                                                                                              |
| Python agent | `unittest` with a WSGI app; assert first-hit line order                                                                                                                             |

The golden end-to-end test is the release gate: if the demo doesn't light up the right lines, nothing ships.
