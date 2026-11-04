# Lightpath wire protocol

Version **1**. Implemented by `packages/protocol/src/messages.ts`; that file is the source of truth if the two disagree.

## Transport

| Endpoint                                        | Transport                                                        | Who connects                                        |
| ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `POST http://127.0.0.1:<port>/v1/ingest`        | HTTP, JSON `IngestBatch` body, `Authorization: Bearer <token>`   | Node agent, browser collector, Python agent         |
| `ws://127.0.0.1:<port>/v1/client?token=<token>` | WebSocket, JSON text frames                                      | VS Code extension, CLI, MCP server                  |
| `GET http://127.0.0.1:<port>/v1/health`         | HTTP                                                             | Anyone (returns `{ ok, protocolVersion }`, no data) |
| `POST http://127.0.0.1:<port>/v1/action`        | HTTP, JSON `ActionRequest` body, `Authorization: Bearer <token>` | MCP server (`run_action`, D-115)                    |

Agents send batches over HTTP instead of holding a WebSocket open. An open socket would keep the user's event loop alive, so short-lived processes (scripts, test runs) would never exit. Agents learn the daemon URL, token, and workspace roots from environment variables the CLI sets: `LIGHTPATH_URL`, `LIGHTPATH_TOKEN`, `LIGHTPATH_ROOTS`, `LIGHTPATH_SKIP`, `LIGHTPATH_DEBUG`.

Every message is a JSON object with a `type` field. An ingest batch with an unknown type or a schema error is rejected with HTTP 400. A client WebSocket message that fails validation closes the connection with code 4400.

```ts
interface IngestBatch {
  protocolVersion: 1;
  agentId: string;
  messages: IngestMessage[];
} // at least one message
```

## Common types

```ts
type TraceId = string; // "t_" + 12 random base36 chars
type CollectorKind = 'browser' | 'node' | 'python';

interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
} // UTF-16 offsets
interface FunctionCoverage {
  functionName: string;
  isBlockCoverage: boolean;
  ranges: CoverageRange[];
}
interface ScriptCoverage {
  scriptId: string;
  url: string;
  functions: FunctionCoverage[];
}

interface ScriptInfo {
  scriptId: string;
  url: string;
  hash: string; // from Debugger.scriptParsed
  length: number;
  sourceMapURL?: string; // must be a data: URL; the Node agent inlines external .map files from the workspace (the daemon never reads files)
}
```

## Ingest messages (inside an `IngestBatch`)

| `type`       | Fields                                                                                                                                                                                                                                                                                                                                                      | Sent by       | When                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hello`      | `protocolVersion`, `kind`, `pid`, `processTitle`, `cwd`, `runtime` (`{ name, version }`)                                                                                                                                                                                                                                                                    | All           | First batch from a process                                                                                                                             |
| `scripts`    | `scripts: ScriptInfo[]`                                                                                                                                                                                                                                                                                                                                     | Node, browser | After `Debugger.enable`, then whenever new scripts are parsed                                                                                          |
| `source`     | `scriptId`, `hash`, `url`, `source`                                                                                                                                                                                                                                                                                                                         | Node, browser | Once per script hash, the first time that script appears in a delta                                                                                    |
| `delta`      | `traceId?`, `phase` (`'background' \| 'action'`), `startedAt`, `endedAt` (ms since epoch), `overlapped?: TraceId[]`, `request?` (`{ method, path, status }`), `beforeRequest?` (`{ method, path }`, browser only: this delta ends as the action's first tagged fetch or XHR left the page; `path` has no query, D-116, D-128), `coverage: ScriptCoverage[]` | Node, browser | At each boundary, and in the browser as an action's first tagged fetch or XHR leaves the page                                                          |
| `traceStart` | `traceId`, `label`, `target` (`{ role?, name?, testId?, text? }`), `at`                                                                                                                                                                                                                                                                                     | Browser       | At pointer down                                                                                                                                        |
| `traceEnd`   | `traceId`, `at`, `settled` (`'quiet' \| 'timeout'`)                                                                                                                                                                                                                                                                                                         | Browser       | After the settle window                                                                                                                                |
| `lines`      | see below                                                                                                                                                                                                                                                                                                                                                   | Python        | At the end of each request                                                                                                                             |
| `problem`    | `traceId?`, `at`, `kind` (`'exception' \| 'console-error' \| 'request-failed' \| 'uncaught'`), `message` (at most 1,000 chars), `location?` (`{ url, line, column }`, generated), `request?` (`{ method, path, status?, failure? }`, path without query)                                                                                                    | Browser, Node | An error or failed request during an action (D-121); without an open trace it is dropped. Node sends `uncaught` synchronously before the process exits |

The daemon replies `204 No Content` on success. It never asks agents for anything, so agents need no listener.

## Python `lines` message

Python reports lines, not offsets, because `sys.monitoring` gives line numbers directly.

```json
{
  "protocolVersion": 1,
  "agentId": "py-4120",
  "messages": [
    {
      "type": "lines",
      "traceId": "t_abc123def456",
      "pid": 4120,
      "startedAt": 1730140000000,
      "endedAt": 1730140000042,
      "request": { "method": "POST", "path": "/api/orders", "status": 201 },
      "files": [{ "path": "C:/repo/api/orders.py", "lines": [12, 13, 15, 40] }]
    }
  ]
}
```

`lines` is in first-hit order. Counts are always 1.

## Daemon → client

| `type`        | Fields                                | When                                                       |
| ------------- | ------------------------------------- | ---------------------------------------------------------- |
| `welcome`     | `protocolVersion`, `workspaceRoots`   | Reply to connect                                           |
| `trace`       | `trace: Trace`                        | When a trace is complete and mapped                        |
| `traceUpdate` | `traceId`, `trace: Trace`             | When a late backend delta arrives for an existing trace    |
| `traces`      | `requestId`, `traces: TraceSummary[]` | Reply to `listTraces`                                      |
| `traceResult` | `requestId`, `trace: Trace \| null`   | Reply to `getTrace` (`null` if the trace has been evicted) |

## Client → daemon

| `type`       | Fields                          |
| ------------ | ------------------------------- |
| `listTraces` | `requestId`, `limit?`, `label?` |
| `getTrace`   | `requestId`, `traceId`          |

## MCP server → daemon: `POST /v1/action`

One action in the app, and its trace in the reply (D-115, [ADR 0007](adr/0007-run-action.md)). Same rules as `/v1/ingest`: 127.0.0.1 only; any `Origin` header → 403; missing or wrong token → 401; body over 256 KB → 413; schema error → 400 (the reply names fields, never values); other `protocolVersion` → 426. Both action outcomes come with HTTP 200. The reply comes when the action is done: the trace has settled, then at most 1.5 s more until every request the browser tagged for it has its backend lines (matched by method and path). A call can take `timeoutMs` + 1.5 s + 2 s.

```ts
interface ActionRequest {
  protocolVersion: 1;
  target: string; // 1..500 chars: 'button "Checkout"', 'Checkout', 'css=button.primary'
  within?: string; // 1..200 chars: text of the row or section that holds the target
  action?: 'click' | 'press'; // default 'click'
  key?: 'Enter' | 'Space'; // only with 'press'; default 'Enter'
  timeoutMs?: number; // integer 500..30000; settle cap for this trace, default 5000
  fill?: { target: string; within?: string; value: string }[]; // at most 20, filled in order first; value at most 10,000 chars, never echoed, logged or stored
}

type ActionResult =
  | {
      ok: true;
      trace: Trace; // as stored, after the backend wait
      boundary: 'press' | 'release' | 'key';
      settled: 'quiet' | 'timeout';
      backend: 'complete' | 'partial';
      pageUrl: string; // after the action
      warnings: { code: 'timeout' | 'click_lost' | 'backend_partial'; message: string }[];
    }
  | {
      ok: false;
      error: {
        code: 'not_found' | 'ambiguous' | 'not_actionable' | 'no_trace' | 'no_browser';
        message: string;
        candidates?: string[]; // up to 10 role-and-name pairs
        count?: number; // matches, for 'ambiguous' and 'not_found'
        fillIndex?: number; // which fill entry failed; never its value
      };
    };
```

`no_browser` means no browser is registered: `lightpath dev` runs with `--no-browser`, or its browser isn't open yet, or was closed. Target forms and outcomes: [design section 4](design/agent-loop.md#4-run_action).

## The `Trace` model

```ts
interface LineHit {
  line: number;
  count: number;
} // 1-based original line
interface FileHits {
  path: string; // workspace-relative, forward slashes
  collector: CollectorKind;
  lines: LineHit[]; // sorted by line
  firstSeenAt: number; // for replay ordering
  background?: boolean; // every lit line came from code that also runs while idle (timers, polling)
}
interface Trace {
  id: TraceId;
  label: string; // "button: Checkout"
  origin: 'browser' | 'backend';
  startedAt: number;
  endedAt?: number;
  files: FileHits[];
  requests: {
    collector: CollectorKind;
    pid: number;
    method: string;
    path: string;
    status?: number;
    durationMs: number;
    overlapped: boolean;
  }[];
  dropped: {
    reason: 'node_modules' | 'outside-workspace' | 'no-source' | 'no-source-map' | 'internal' | 'ignored';
    count: number;
  }[];
  phases?: TracePhase[]; // D-116; absent from daemons before build 2
  functions?: FunctionHit[]; // outermost and nested; a function that runs in two phases appears twice
  problems?: TraceProblem[]; // D-121; at most 50
  problemsDropped?: number; // problems past the 50
}
interface TraceProblem {
  collector: CollectorKind;
  kind: 'exception' | 'console-error' | 'request-failed' | 'uncaught';
  message: string; // stored as received; MCP tools redact it when printed (D-123)
  at: number;
  path?: string; // workspace-relative, when the location maps into the workspace
  line?: number; // original, 1-based
  request?: { method: string; path: string; status?: number; failure?: string };
}
interface TracePhase {
  kind: 'before-request' | 'backend' | 'after-response' | 'browser'; // 'browser': no tagged request was read
  request?: number; // index into Trace.requests, for 'before-request' and 'backend'
}
interface FunctionHit {
  path: string; // workspace-relative, like FileHits.path
  collector: CollectorKind;
  name: string; // '' when V8 has no name
  startLine: number; // original, 1-based
  endLine: number;
  count: number; // calls in this phase; 0: it resumed after an await without a new call
  notRun?: number[]; // lines inside it with count 0 in this phase, sorted
  notRunSpans?: { line: number; startColumn: number; endColumn: number; text: string }[]; // untaken blocks inside a line that ran; text at most 40 chars, '' when unknown
  unknown?: { lines: number[]; threwAfter: number }[]; // lines with no count: a call threw on or after line threwAfter, in a try whose catch ran (D-151)
  phase: number; // index into Trace.phases
}
```

Phases are in time order: a `before-request` phase for the browser delta with `beforeRequest` (at most one per action, D-128), a `backend` phase for each backend delta or Python `lines` message, and one closing browser phase for the other browser reads, last. That last phase is `after-response` when any request was read before it, else `browser`. A `before-request` phase points at the first unmatched backend request with the same method and path. Python files have no functions; they are in `files` only. `TraceSummary` (`traces` replies) gains `problemCount?` when a trace has problems.

`ignored` counts files that match an `ignore` glob in `lightpath.config.json`.

## Versioning

- `protocolVersion` is an integer. A daemon accepts agents with the same major version only and replies with close code 4426 otherwise.
- Adding an optional field is not a version bump. Removing or retyping a field is.
