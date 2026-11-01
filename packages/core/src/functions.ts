import { eachMapping, type TraceMap } from '@jridgewell/trace-mapping';
import type { FunctionCoverage } from '@lightpath-dev/protocol';
import { LineIndex } from './line-index.js';
import type { LineCounts } from './lines.js';
import type { ScriptInput } from './pipeline.js';
import { type ResolveContext, resolveFile, webpackModulePath } from './resolve.js';
import { newTraceMap } from './sourcemap.js';

/** An untaken block inside one line that ran. Columns are 0-based, `endColumn` exclusive. */
export interface NotRunSpan {
  line: number;
  startColumn: number;
  endColumn: number;
  /** The block's text, at most 40 characters; '' when the original text isn't known. */
  text: string;
}

/** One function that ran in a script delta, in original lines (design section 5.3). */
export interface FunctionResult {
  /** Workspace-relative path. */
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  count: number;
  /** Lines inside the function with count 0 in this delta, sorted. */
  notRun: number[];
  notRunSpans: NotRunSpan[];
}

interface Position {
  source: string;
  /** 1-based. */
  line: number;
  /** 0-based. */
  column: number;
  /** The map's source URL, to find sourcesContent. */
  raw?: string;
}

/**
 * Lists the functions that ran in one script delta, with their original line range, call count,
 * lines known not to have run, and untaken blocks inside lines that ran (D-116).
 *
 * `files` is `mapScript`'s result for the same input: not-run lines come from it, so a function's
 * lines agree with its file's. The script's own top-level function is left out (it spans the
 * whole file). A function is listed when any of its ranges ran: a count of 0 with a block that
 * ran means it resumed after an await.
 *
 * One pass over the source map's mappings, then a binary search per position, so a large bundle
 * with many functions stays linear in its mappings.
 */
export function mapFunctions(
  input: ScriptInput,
  files: ReadonlyMap<string, LineCounts>,
  ctx: ResolveContext,
): FunctionResult[] {
  const source = input.source;
  const index = new LineIndex(source);
  let locate: (offset: number) => Position | undefined;
  let textOf: (pos: Position, end: Position) => string;
  const lines = source.split('\n');

  if (!input.sourceMap) {
    const target = resolveFile(input.coverage.url, ctx);
    if (target.kind === 'dropped' || webpackModulePath(input.coverage.url) !== undefined) return [];
    locate = (offset) => {
      const line = index.lineOf(offset);
      return { source: target.path, line: line + 1, column: offset - index.lineStart(line) };
    };
    textOf = (a, b) => (lines[a.line - 1] ?? '').slice(a.column, b.column + 1);
  } else {
    const tracer = newTraceMap(input.sourceMap, input.sourceMapUrl ?? input.coverage.url);
    const spans = mappingSpans(tracer, index);
    const resolved = new Map<string, string | undefined>();
    const pathOf = (src: string) => {
      if (!resolved.has(src)) {
        const r = resolveFile(src, ctx);
        resolved.set(src, r.kind === 'workspace' ? r.path : undefined);
      }
      return resolved.get(src);
    };
    const contents = new Map<string, string[] | undefined>();
    const contentOf = (src: string) => {
      if (!contents.has(src)) {
        const i = tracer.resolvedSources.indexOf(src);
        const text = i >= 0 ? tracer.sourcesContent?.[i] : undefined;
        contents.set(src, text == null ? undefined : text.split('\n'));
      }
      return contents.get(src);
    };
    locate = (offset) => {
      const span = spanAt(spans, offset);
      if (!span || span.source === undefined) return undefined;
      const path = pathOf(span.source);
      if (path === undefined) return undefined;
      const sameLine = index.lineOf(offset) === index.lineOf(span.offset);
      return {
        source: path,
        line: span.line,
        column: span.column + (sameLine ? offset - span.offset : 0),
        raw: span.source,
      };
    };
    textOf = (a) => {
      const text = a.raw ? contentOf(a.raw)?.[a.line - 1] : undefined;
      if (text === undefined) return '';
      // The mapped end is approximate; take the block's start and the token it begins with.
      const rest = text.slice(a.column);
      return /^[^,;)}\]]*/.exec(rest)?.[0] ?? '';
    };
  }

  const out: FunctionResult[] = [];
  for (const fn of input.coverage.functions) {
    const top = fn.ranges[0];
    if (!top || top.startOffset === 0) continue; // the script's own top-level code
    if (!fn.ranges.some((r) => r.count > 0)) continue;
    const range = mappedRange(fn, locate);
    if (!range) continue;
    const counts = files.get(range.path);
    const notRun: number[] = [];
    for (let l = range.startLine; l <= range.endLine; l++) if (counts?.get(l) === 0) notRun.push(l);
    const notRunSpans: NotRunSpan[] = [];
    for (const r of fn.ranges.slice(1)) {
      if (r.count !== 0 || r.endOffset <= r.startOffset) continue;
      const a = locate(r.startOffset);
      const b = locate(r.endOffset - 1);
      if (!a || !b || a.source !== range.path || b.source !== range.path || a.line !== b.line) continue;
      if (!((counts?.get(a.line) ?? 0) > 0)) continue; // the whole line didn't run: a line marker covers it
      const text = textOf(a, b).replace(/\s+/g, ' ').trim().slice(0, 40);
      notRunSpans.push({
        line: a.line,
        startColumn: a.column,
        endColumn: Math.max(a.column, b.column) + 1,
        text,
      });
    }
    out.push({
      path: range.path,
      name: fn.functionName,
      startLine: range.startLine,
      endLine: range.endLine,
      count: top.count,
      notRun,
      notRunSpans,
    });
  }
  return out;
}

/** The function's first and last original lines in the file its start maps to. */
function mappedRange(
  fn: FunctionCoverage,
  locate: (offset: number) => Position | undefined,
): { path: string; startLine: number; endLine: number } | undefined {
  const top = fn.ranges[0];
  if (!top) return undefined;
  const start = locate(top.startOffset);
  if (!start) return undefined;
  const end = locate(Math.max(top.startOffset, top.endOffset - 1));
  const endLine = end && end.source === start.source && end.line >= start.line ? end.line : start.line;
  return { path: start.source, startLine: start.line, endLine };
}

interface MappingSpan {
  /** Generated offset where the mapping starts. */
  offset: number;
  /** Resolved source URL, or undefined for generated code with no original. */
  source: string | undefined;
  line: number;
  column: number;
}

/** Every mapping as a span start, in generated order. */
function mappingSpans(tracer: TraceMap, index: LineIndex): MappingSpan[] {
  const out: MappingSpan[] = [];
  eachMapping(tracer, (m) => {
    out.push({
      offset: index.lineStart(m.generatedLine - 1) + m.generatedColumn,
      source: m.source ?? undefined,
      line: m.originalLine ?? 0,
      column: m.originalColumn ?? 0,
    });
  });
  return out;
}

/** The last span starting at or before `offset`. */
function spanAt(spans: readonly MappingSpan[], offset: number): MappingSpan | undefined {
  let lo = 0;
  let hi = spans.length - 1;
  let found: MappingSpan | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = spans[mid] as MappingSpan;
    if (s.offset <= offset) {
      found = s;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
