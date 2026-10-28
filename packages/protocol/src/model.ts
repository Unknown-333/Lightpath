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

export const Trace = z.object({
  id: TraceId,
  label: z.string(),
  origin: z.enum(['browser', 'backend']),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  files: z.array(FileHits),
  requests: z.array(TraceRequest),
  dropped: z.array(z.object({ reason: DropReason, count: z.number().int().nonnegative() })),
});
export type Trace = z.infer<typeof Trace>;

export const TraceSummary = z.object({
  id: TraceId,
  label: z.string(),
  startedAt: z.number(),
  fileCount: z.number().int().nonnegative(),
});
export type TraceSummary = z.infer<typeof TraceSummary>;
