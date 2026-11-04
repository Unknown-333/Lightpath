import { z } from 'zod';

/** Protocol version. Bump only for breaking changes (see docs/PROTOCOL.md). */
export const PROTOCOL_VERSION = 1;

/** Header the browser collector adds to backend requests (ADR 0004). */
export const TRACE_HEADER = 'x-lightpath-trace';

export const TraceId = z.string().regex(/^t_[a-z0-9]{12}$/);
export type TraceId = z.infer<typeof TraceId>;

export const CollectorKind = z.enum(['browser', 'node', 'python']);
export type CollectorKind = z.infer<typeof CollectorKind>;

const offset = z.number().int().nonnegative();

/** V8 coverage range. Offsets are UTF-16 code unit indexes into the script source. */
export const CoverageRange = z.object({ startOffset: offset, endOffset: offset, count: offset });
export type CoverageRange = z.infer<typeof CoverageRange>;

export const FunctionCoverage = z.object({
  functionName: z.string(),
  isBlockCoverage: z.boolean(),
  ranges: z.array(CoverageRange),
});
export type FunctionCoverage = z.infer<typeof FunctionCoverage>;

export const ScriptCoverage = z.object({
  scriptId: z.string(),
  url: z.string(),
  functions: z.array(FunctionCoverage),
});
export type ScriptCoverage = z.infer<typeof ScriptCoverage>;

export const ScriptInfo = z.object({
  scriptId: z.string(),
  url: z.string(),
  hash: z.string(),
  length: offset,
  /**
   * Must be a `data:` URL. Collectors inline external source maps before sending, so the
   * daemon never fetches URLs or reads paths supplied by an agent.
   */
  sourceMapURL: z.string().startsWith('data:').optional(),
});
export type ScriptInfo = z.infer<typeof ScriptInfo>;

export const RequestInfo = z.object({
  method: z.string(),
  path: z.string(),
  status: z.number().int().optional(),
});
export type RequestInfo = z.infer<typeof RequestInfo>;

export const LineHit = z.object({ line: z.number().int().positive(), count: z.number().int().positive() });
export type LineHit = z.infer<typeof LineHit>;

export const FileHits = z.object({
  /** Workspace-relative path with forward slashes. */
  path: z.string(),
  collector: CollectorKind,
  /** Sorted by line. */
  lines: z.array(LineHit),
  firstSeenAt: z.number(),
  background: z.boolean().optional(),
});
export type FileHits = z.infer<typeof FileHits>;

export const DropReason = z.enum([
  'node_modules',
  'outside-workspace',
  'no-source',
  'no-source-map',
  'internal',
  'ignored',
]);
export type DropReason = z.infer<typeof DropReason>;

export const TraceRequest = z.object({
  collector: CollectorKind,
  pid: z.number().int(),
  method: z.string(),
  path: z.string(),
  status: z.number().int().optional(),
  durationMs: z.number().nonnegative(),
  overlapped: z.boolean(),
});
export type TraceRequest = z.infer<typeof TraceRequest>;

/** One phase of an action (D-116): browser code before a request left, that request's backend, the rest. */
export const TracePhase = z.object({
  /** `browser`: a browser action with no tagged request read. */
  kind: z.enum(['before-request', 'backend', 'after-response', 'browser']),
  /** Index into `Trace.requests`, for `before-request` and `backend`. */
  request: z.number().int().nonnegative().optional(),
});
export type TracePhase = z.infer<typeof TracePhase>;

/** A function that ran in one phase (D-116, design section 5.3). Lines are original and 1-based. */
export const FunctionHit = z.object({
  /** Workspace-relative, like `FileHits.path`. */
  path: z.string(),
  collector: CollectorKind,
  /** '' when V8 has no name; printed "(anonymous)". */
  name: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  /** Calls in this phase; 0 means the function resumed (after an await) without a new call. */
  count: z.number().int().nonnegative(),
  /** Lines inside the function known not to have run (count 0), sorted. */
  notRun: z.array(z.number().int().positive()).optional(),
  /** Untaken blocks inside a line that ran. `text` is at most 40 characters, '' when unknown. */
  notRunSpans: z
    .array(
      z.object({
        line: z.number().int().positive(),
        startColumn: z.number().int().nonnegative(),
        endColumn: z.number().int().nonnegative(),
        text: z.string().max(40),
      }),
    )
    .optional(),
  /**
   * Lines with no count because a call threw before them (D-151): the catch of their try ran.
   * `threwAfter` is the try block's first line, the last one known to have run.
   */
  unknown: z
    .array(z.object({ lines: z.array(z.number().int().positive()), threwAfter: z.number().int().positive() }))
    .optional(),
  /** Index into `Trace.phases`. */
  phase: z.number().int().nonnegative(),
});
export type FunctionHit = z.infer<typeof FunctionHit>;

export const ProblemKind = z.enum(['exception', 'console-error', 'request-failed', 'uncaught']);
export type ProblemKind = z.infer<typeof ProblemKind>;

export const ProblemRequest = z.object({
  method: z.string(),
  path: z.string(),
  status: z.number().int().optional(),
  failure: z.string().optional(),
});
export type ProblemRequest = z.infer<typeof ProblemRequest>;

/** An error or failed request attached to a trace (D-121). Messages are stored as received. */
export const TraceProblem = z.object({
  collector: CollectorKind,
  kind: ProblemKind,
  /** Stored as received; redacted when printed (D-123). */
  message: z.string(),
  at: z.number(),
  /** Workspace-relative, when the location maps into the workspace. */
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  request: ProblemRequest.optional(),
});
export type TraceProblem = z.infer<typeof TraceProblem>;

/** Most problems kept per trace; more are counted in `problemsDropped`. */
export const MAX_TRACE_PROBLEMS = 50;

export const Trace = z.object({
  id: TraceId,
  label: z.string(),
  origin: z.enum(['browser', 'backend']),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  files: z.array(FileHits),
  requests: z.array(TraceRequest),
  dropped: z.array(z.object({ reason: DropReason, count: z.number().int().nonnegative() })),
  phases: z.array(TracePhase).optional(),
  /** Outermost and nested; a function that runs in two phases appears twice. */
  functions: z.array(FunctionHit).optional(),
  /** At most MAX_TRACE_PROBLEMS (D-121). */
  problems: z.array(TraceProblem).optional(),
  problemsDropped: z.number().int().nonnegative().optional(),
});
export type Trace = z.infer<typeof Trace>;

export const TraceSummary = z.object({
  id: TraceId,
  label: z.string(),
  startedAt: z.number(),
  fileCount: z.number().int().nonnegative(),
  problemCount: z.number().int().nonnegative().optional(),
});
export type TraceSummary = z.infer<typeof TraceSummary>;
