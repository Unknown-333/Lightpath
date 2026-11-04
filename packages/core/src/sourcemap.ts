import { eachMapping, originalPositionFor, type SourceMapInput, TraceMap } from '@jridgewell/trace-mapping';
import { CODE, isJumpOnly, PUNCT, previousCode } from './code-mask.js';
import { countAt, type Segment } from './flatten.js';
import type { LineIndex } from './line-index.js';
import type { LineCounts } from './lines.js';

/** Original source URL or path (as resolved by the source map) → line counts. */
export type OriginalCounts = Map<string, LineCounts>;

/**
 * Maps flattened segments of a generated script back to original source lines.
 *
 * Walks every mapping in the source map. A mapping covers the generated text up to the next
 * mapping on the same line (or the line's end). It counts only if code starts in that span: the
 * count is taken at the first non-whitespace character, and its original line keeps the maximum.
 * Mappings over whitespace or the end of a line are skipped. tsc writes one just after every `}`,
 * and V8 counts that position as the enclosing code, so an untaken block's closing brace would
 * light up. Generated code with no mapping (compiler helpers, HMR glue) contributes nothing.
 *
 * Source map columns and V8 offsets are both UTF-16 code units, so they line up directly.
 */
export function mapToOriginal(
  segments: readonly Segment[],
  generated: LineIndex,
  map: SourceMapInput,
  mapUrl?: string,
): OriginalCounts {
  const tracer = newTraceMap(map, mapUrl);
  const mask = generated.mask;
  const text = generated.source;
  /** Counts from mappings that start with code, and from mappings with only punctuation (D-149). */
  const code: OriginalCounts = new Map();
  const punct: OriginalCounts = new Map();
  const keep = (into: OriginalCounts, source: string, line: number, count: number) => {
    let lines = into.get(source);
    if (!lines) {
      lines = new Map();
      into.set(source, lines);
    }
    const prev = lines.get(line);
    if (prev === undefined || count > prev) lines.set(line, count);
  };

  /** Credits one mapping whose generated span is `[span.offset, end)`. */
  const credit = (span: OpenSpan, end: number) => {
    const stop = Math.min(end, text.length);
    let codeAt: number | undefined;
    let punctAt: number | undefined;
    for (let i = Math.max(0, span.offset); i < stop; i++) {
      const kind = mask[i];
      if (kind === CODE) {
        codeAt = i;
        break;
      }
      if (kind === PUNCT && punctAt === undefined) punctAt = i;
    }
    const at = codeAt ?? punctAt;
    if (at === undefined) return; // only whitespace or comments: nothing ran here
    let count = countAt(segments, at);
    if (count === undefined || count < 0) return; // no data, or unknown (D-153)
    if (codeAt !== undefined && isJumpOnly(text, mask, codeAt, stop)) {
      // V8 ends a `case` clause's range where its `break` starts (D-149).
      const before = previousCode(mask, codeAt);
      const prior = before === undefined ? undefined : countAt(segments, before);
      if (prior !== undefined && prior >= 0 && prior < count) count = prior;
    }
    keep(codeAt !== undefined ? code : punct, span.source, span.originalLine, count);
  };

  // eachMapping visits mappings in generated order, so each span ends where the next mapping
  // starts, or at the end of its line (source map lines are independent).
  let open: OpenSpan | undefined;
  eachMapping(tracer, (m) => {
    const offset = generated.lineStart(m.generatedLine - 1) + m.generatedColumn;
    if (open) credit(open, open.line === m.generatedLine ? offset : lineEnd(generated, open.line));
    open =
      m.source != null && m.originalLine != null
        ? { offset, line: m.generatedLine, source: m.source, originalLine: m.originalLine }
        : undefined;
  });
  if (open) credit(open, lineEnd(generated, open.line));
  // A line with code takes its code's count; a line of only punctuation keeps the punctuation's.
  const out: OriginalCounts = new Map();
  for (const [source, lines] of punct) out.set(source, new Map(lines));
  for (const [source, lines] of code) {
    const merged = out.get(source) ?? new Map();
    for (const [line, count] of lines) merged.set(line, count);
    out.set(source, merged);
  }
  return out;
}

/**
 * The original source and 1-based line of a generated position (1-based line, 0-based column),
 * for an error's location (D-121). Undefined when the map has nothing there.
 */
export function originalLocation(
  map: SourceMapInput,
  mapUrl: string | undefined,
  line: number,
  column: number,
): { source: string; line: number } | undefined {
  const pos = originalPositionFor(newTraceMap(map, mapUrl), { line, column });
  return pos.source != null && pos.line != null ? { source: pos.source, line: pos.line } : undefined;
}

/** A TraceMap for a script's map, with Windows paths in `sources` fixed (see below). */
export function newTraceMap(map: SourceMapInput, mapUrl?: string): TraceMap {
  return new TraceMap(withWindowsSourcesAsUrls(map), mapUrl);
}

interface OpenSpan {
  offset: number;
  /** 1-based generated line. */
  line: number;
  source: string;
  originalLine: number;
}

/** Offset of the end of a 1-based generated line (its newline, or the end of the source). */
function lineEnd(index: LineIndex, line: number): number {
  return line < index.lineCount ? index.lineStart(line) : Number.POSITIVE_INFINITY;
}

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;

/**
 * Rewrites Windows absolute paths in `sources` (and `sourceRoot`) as `file:///C:/...` URLs.
 *
 * Some tools write them as-is: tsx on Windows emits `C:\repo\src\a.ts`. trace-mapping only knows
 * URLs and POSIX paths, so it treats `C:\...` as relative and appends it to the map URL, which
 * yields a path that exists nowhere. POSIX absolute paths and URLs already resolve correctly.
 */
function withWindowsSourcesAsUrls(map: SourceMapInput): SourceMapInput {
  if (map instanceof TraceMap) return map;
  const parsed =
    typeof map === 'string' ? (JSON.parse(map) as Exclude<SourceMapInput, string | TraceMap>) : map;
  const root = parsed.sourceRoot;
  const rootIsWindows = typeof root === 'string' && WINDOWS_ABSOLUTE.test(root);
  if (!rootIsWindows && !parsed.sources.some((s) => s != null && WINDOWS_ABSOLUTE.test(s))) return parsed;
  return {
    ...parsed,
    ...(rootIsWindows ? { sourceRoot: `${windowsPathToUrl(root)}/` } : {}),
    sources: parsed.sources.map((s) => (s != null && WINDOWS_ABSOLUTE.test(s) ? windowsPathToUrl(s) : s)),
  };
}

/** `C:\a b\c#.ts` → `file:///C:/a%20b/c%23.ts`. Only characters that would break URL parsing are escaped. */
function windowsPathToUrl(path: string): string {
  const escaped = path
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/[%#? ]/g, (c) => encodeURIComponent(c));
  return `file:///${escaped}`;
}

/**
 * Decodes an inline `data:` source map URL (base64 or percent-encoded JSON).
 * Returns `undefined` for non-data URLs, which the caller must fetch itself.
 */
export function decodeDataUrlSourceMap(url: string): SourceMapInput | undefined {
  if (!url.startsWith('data:')) return undefined;
  const comma = url.indexOf(',');
  if (comma < 0) return undefined;
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const json = meta.endsWith(';base64') ? decodeBase64Utf8(body) : decodeURIComponent(body);
  return JSON.parse(json) as SourceMapInput;
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
