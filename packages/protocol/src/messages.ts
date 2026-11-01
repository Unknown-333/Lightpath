import { z } from 'zod';
import {
  CollectorKind,
  RequestInfo,
  ScriptCoverage,
  ScriptInfo,
  Trace,
  TraceId,
  TraceSummary,
} from './model.js';

const version = z.number().int().positive();
const epochMs = z.number().nonnegative();
const requestId = z.string().min(1);

// ── Agent → daemon ──────────────────────────────────────────────────────────

export const HelloMessage = z.object({
  type: z.literal('hello'),
  protocolVersion: version,
  kind: CollectorKind,
  pid: z.number().int(),
  processTitle: z.string(),
  cwd: z.string(),
  runtime: z.object({ name: z.string(), version: z.string() }),
});

export const ScriptsMessage = z.object({ type: z.literal('scripts'), scripts: z.array(ScriptInfo) });

export const DeltaMessage = z.object({
  type: z.literal('delta'),
  traceId: TraceId.optional(),
  phase: z.enum(['background', 'action']),
  startedAt: epochMs,
  endedAt: epochMs,
  overlapped: z.array(TraceId).optional(),
  request: RequestInfo.optional(),
  coverage: z.array(ScriptCoverage),
});

/** Sent once per script hash, the first time the script appears in a delta. */
export const SourceMessage = z.object({
  type: z.literal('source'),
  scriptId: z.string(),
  hash: z.string(),
  url: z.string(),
  source: z.string(),
});

export const TraceStartMessage = z.object({
  type: z.literal('traceStart'),
  traceId: TraceId,
  label: z.string(),
  target: z.object({
    role: z.string().optional(),
    name: z.string().optional(),
    testId: z.string().optional(),
    text: z.string().optional(),
  }),
  at: epochMs,
});

export const TraceEndMessage = z.object({
  type: z.literal('traceEnd'),
  traceId: TraceId,
  at: epochMs,
  settled: z.enum(['quiet', 'timeout']),
});

// ── Ingest envelope (HTTP POST /v1/ingest) ──────────────────────────────────
//
// Agents never hold a connection open: a persistent socket would keep the user's
// event loop alive and stop short-lived processes from exiting. Configuration comes
// from environment variables that the CLI sets (see AgentEnv).

export const LinesIngest = z.object({
  type: z.literal('lines'),
  traceId: TraceId.optional(),
  pid: z.number().int(),
  startedAt: epochMs,
  endedAt: epochMs,
  request: RequestInfo.optional(),
  /** Absolute paths; `lines` in first-hit order (Python's sys.monitoring gives no counts). */
  files: z.array(z.object({ path: z.string(), lines: z.array(z.number().int().positive()) })),
});
export type LinesIngest = z.infer<typeof LinesIngest>;

export const IngestMessage = z.discriminatedUnion('type', [
  HelloMessage,
  ScriptsMessage,
  DeltaMessage,
  SourceMessage,
  TraceStartMessage,
  TraceEndMessage,
  LinesIngest,
]);
export type IngestMessage = z.infer<typeof IngestMessage>;
export type HelloMessage = z.infer<typeof HelloMessage>;
export type ScriptsMessage = z.infer<typeof ScriptsMessage>;
export type DeltaMessage = z.infer<typeof DeltaMessage>;
export type SourceMessage = z.infer<typeof SourceMessage>;
export type TraceStartMessage = z.infer<typeof TraceStartMessage>;
export type TraceEndMessage = z.infer<typeof TraceEndMessage>;

export const IngestBatch = z.object({
  protocolVersion: version,
  /** Identifies the sending process across batches. */
  agentId: z.string().min(1),
  messages: z.array(IngestMessage).min(1),
});
export type IngestBatch = z.infer<typeof IngestBatch>;

/** Environment variables the CLI sets for agents. */
export const AgentEnv = {
  /** Daemon base URL, e.g. http://127.0.0.1:43117 */
  url: 'LIGHTPATH_URL',
  token: 'LIGHTPATH_TOKEN',
  /** Comma-separated workspace roots. */
  roots: 'LIGHTPATH_ROOTS',
  /** Regex matched against process.argv.join(' '); matching processes skip instrumentation. */
  skip: 'LIGHTPATH_SKIP',
  /** Set to 1 for agent debug logging on stderr. */
  debug: 'LIGHTPATH_DEBUG',
} as const;

// ── Client ↔ daemon ─────────────────────────────────────────────────────────

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('listTraces'),
    requestId,
    limit: z.number().int().positive().optional(),
    label: z.string().optional(),
  }),
  z.object({ type: z.literal('getTrace'), requestId, traceId: TraceId }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const DaemonToClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), protocolVersion: version, workspaceRoots: z.array(z.string()) }),
  z.object({ type: z.literal('trace'), trace: Trace }),
  z.object({ type: z.literal('traceUpdate'), traceId: TraceId, trace: Trace }),
  z.object({ type: z.literal('traces'), requestId, traces: z.array(TraceSummary) }),
  z.object({ type: z.literal('traceResult'), requestId, trace: Trace.nullable() }),
]);
export type DaemonToClientMessage = z.infer<typeof DaemonToClientMessage>;

// ── MCP server → daemon: one action (HTTP POST /v1/action, D-115) ──────────

/** Largest `/v1/action` body, in bytes: room for 20 `fill` values of 10,000 characters. */
export const MAX_ACTION_BYTES = 256 * 1024;

const actionTarget = z.string().min(1).max(500);
const actionWithin = z.string().min(1).max(200);

export const ActionFill = z.object({
  target: actionTarget,
  within: actionWithin.optional(),
  /** A secret: never echoed, logged or stored (D-123 rule 6). */
  value: z.string().max(10_000),
});
export type ActionFill = z.infer<typeof ActionFill>;

export const ActionRequest = z
  .object({
    protocolVersion: version,
    /** `button "Checkout"`, `Checkout`, or `css=button.primary`. */
    target: actionTarget,
    within: actionWithin.optional(),
    action: z.enum(['click', 'press']).optional(),
    key: z.enum(['Enter', 'Space']).optional(),
    timeoutMs: z.number().int().min(500).max(30_000).optional(),
    fill: z.array(ActionFill).max(20).optional(),
  })
  .refine((r) => r.key === undefined || r.action === 'press', {
    message: '`key` is only allowed with action "press"',
    path: ['key'],
  });
export type ActionRequest = z.infer<typeof ActionRequest>;

export const ActionErrorCode = z.enum(['not_found', 'ambiguous', 'not_actionable', 'no_trace', 'no_browser']);
export type ActionErrorCode = z.infer<typeof ActionErrorCode>;
export const ActionWarningCode = z.enum(['timeout', 'click_lost', 'backend_partial']);
export type ActionWarningCode = z.infer<typeof ActionWarningCode>;

const ActionWarning = z.object({ code: ActionWarningCode, message: z.string() });
export type ActionWarning = z.infer<typeof ActionWarning>;

export const ActionError = z.object({
  code: ActionErrorCode,
  message: z.string(),
  candidates: z.array(z.string()).optional(),
  count: z.number().int().nonnegative().optional(),
  /** Which `fill` entry failed. Never its value. */
  fillIndex: z.number().int().nonnegative().optional(),
});
export type ActionError = z.infer<typeof ActionError>;

export const ActionResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** As stored, after the backend wait. */
    trace: Trace,
    boundary: z.enum(['press', 'release', 'key']),
    settled: z.enum(['quiet', 'timeout']),
    backend: z.enum(['complete', 'partial']),
    /** The page URL after the action. */
    pageUrl: z.string(),
    warnings: z.array(ActionWarning),
  }),
  z.object({ ok: z.literal(false), error: ActionError }),
]);
export type ActionResult = z.infer<typeof ActionResult>;

/**
 * What the process that owns the browser reports back for one action, before the daemon's backend
 * wait (in-process only, not on the wire). `tagged` lists the requests the collector gave this
 * trace's header, so the daemon knows which backend deltas to wait for.
 */
export type ActionRunOutcome =
  | {
      ok: true;
      traceId: TraceId;
      boundary: 'press' | 'release' | 'key';
      settled: 'quiet' | 'timeout';
      pageUrl: string;
      tagged: { method: string; path: string }[];
      warnings: ActionWarning[];
    }
  | { ok: false; error: ActionError };

/** Runs one action on the page `lightpath dev` opened (`daemon.setActionRunner`). */
export type ActionRunner = (request: ActionRequest) => Promise<ActionRunOutcome>;
