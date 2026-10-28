# Lightpath wire protocol

Version **1**. Implemented by `packages/protocol/src/messages.ts`; that file is the source of truth if the two disagree.

## Transport

| Endpoint                                        | Transport                                                      | Who connects                                        |
| ----------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| `POST http://127.0.0.1:<port>/v1/ingest`        | HTTP, JSON `IngestBatch` body, `Authorization: Bearer <token>` | Node agent, browser collector, Python agent         |
| `ws://127.0.0.1:<port>/v1/client?token=<token>` | WebSocket, JSON text frames                                    | VS Code extension, CLI, MCP server                  |
| `GET http://127.0.0.1:<port>/v1/health`         | HTTP                                                           | Anyone (returns `{ ok, protocolVersion }`, no data) |

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
  sourceMapURL?: string; // must be a data: URL; collectors inline external maps (the daemon never fetches)
}
```

## Ingest messages (inside an `IngestBatch`)

| `type`       | Fields                                                                                                                                                                                     | Sent by       | When                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------- |
| `hello`      | `protocolVersion`, `kind`, `pid`, `processTitle`, `cwd`, `runtime` (`{ name, version }`)                                                                                                   | All           | First batch from a process                                          |
| `scripts`    | `scripts: ScriptInfo[]`                                                                                                                                                                    | Node, browser | After `Debugger.enable`, then whenever new scripts are parsed       |
| `source`     | `scriptId`, `hash`, `url`, `source`                                                                                                                                                        | Node, browser | Once per script hash, the first time that script appears in a delta |
| `delta`      | `traceId?`, `phase` (`'background' \| 'action'`), `startedAt`, `endedAt` (ms since epoch), `overlapped?: TraceId[]`, `request?` (`{ method, path, status }`), `coverage: ScriptCoverage[]` | Node, browser | At each boundary                                                    |
| `traceStart` | `traceId`, `label`, `target` (`{ role?, name?, testId?, text? }`), `at`                                                                                                                    | Browser       | At pointer down                                                     |
| `traceEnd`   | `traceId`, `at`, `settled` (`'quiet' \| 'timeout'`)                                                                                                                                        | Browser       | After the settle window                                             |
| `lines`      | see below                                                                                                                                                                                  | Python        | At the end of each request                                          |

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
  background?: boolean; // seen only in background windows
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
    reason: 'node_modules' | 'outside-workspace' | 'no-source' | 'no-source-map' | 'internal';
    count: number;
  }[];
}
```

## Versioning

- `protocolVersion` is an integer. A daemon accepts agents with the same major version only and replies with close code 4426 otherwise.
- Adding an optional field is not a version bump. Removing or retyping a field is.
