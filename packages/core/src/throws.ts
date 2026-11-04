import type { FunctionCoverage } from '@lightpath-dev/protocol';
import { CODE, codeMask, PUNCT } from './code-mask.js';
import { countAt, type Segment } from './flatten.js';

/** A segment count meaning "unknown": the line shows neither as run nor as not run (D-150). */
export const UNKNOWN = -1;

/**
 * Marks code after a call that threw as unknown (D-150).
 *
 * V8 keeps no counter after a call that throws: the rest of the block keeps the block's count, so
 * `const doubled = qty * 2` after a `mustBePositive(n)` that threw reads as run. When the `catch` of
 * a `try` ran, the try block was left early that many times, at a point coverage can't show. So in
 * that try block, after the line of its first statement, code that only has the block's own count
 * becomes unknown. Code with its own counter (an inner block or function with another count) keeps
 * it: those counts are exact.
 *
 * Found with a lexer over the script V8 ran (code-mask.ts). A try block written on one line (minified
 * code) has no line after its first statement, so nothing changes there. A throw that leaves a
 * function with no `catch` of its own leaves no trace in that function's coverage; it is not handled.
 */
/** A try block whose catch ran: `[from, to)` loses the count `count`; `first` is its first statement. */
export interface ThrowRegion {
  /** The try block's `{`: a range that starts after it has its own counter. */
  open: number;
  from: number;
  to: number;
  count: number;
  first: number;
}

export function findThrowRegions(
  segments: readonly Segment[],
  source: string,
  mask = codeMask(source),
): ThrowRegion[] {
  if (segments.length === 0 || !source.includes('try')) return [];
  const close = matchBraces(source, mask);
  const regions: ThrowRegion[] = [];
  for (let i = source.indexOf('try'); i >= 0; i = source.indexOf('try', i + 3)) {
    if (!isWordAt(source, mask, i, 'try')) continue;
    const open = nextCode(mask, i + 3);
    if (open === undefined || source[open] !== '{' || mask[open] !== PUNCT) continue;
    const end = close.get(open);
    if (end === undefined) continue;
    const afterTry = nextCode(mask, end + 1);
    if (afterTry === undefined || !isWordAt(source, mask, afterTry, 'catch')) continue;
    let body = nextCode(mask, afterTry + 5);
    if (body !== undefined && source[body] === '(') {
      const paren = matchParen(source, mask, body);
      body = paren === undefined ? undefined : nextCode(mask, paren + 1);
    }
    if (body === undefined || source[body] !== '{') continue;
    const bodyEnd = close.get(body) ?? body;
    const first = nextCode(mask, open + 1);
    if (first === undefined || first >= end) continue;
    const firstInCatch = nextCode(mask, body + 1);
    const catchAt = firstInCatch !== undefined && firstInCatch < bodyEnd ? firstInCatch : body;
    const tryCount = countAt(segments, first);
    const catchCount = countAt(segments, catchAt);
    if (tryCount === undefined || catchCount === undefined || tryCount <= 0 || catchCount <= 0) continue;
    const newline = source.indexOf('\n', first);
    if (newline < 0 || newline >= end) continue;
    regions.push({ open, from: newline, to: end, count: tryCount, first });
  }
  return regions;
}

/**
 * The segments with each region's inherited code marked UNKNOWN. `starts` is `flattenRanges` over
 * the same ranges with each count replaced by the range's start: at every offset, where the innermost
 * range starts. Code whose innermost range starts before the try block inherited the outer count;
 * code in a range that starts inside it (an `if` block, a callback) has its own exact counter.
 */
export function applyUnknown(
  segments: readonly Segment[],
  regions: readonly ThrowRegion[],
  starts: readonly Segment[],
): Segment[] {
  let out = [...segments];
  for (const r of regions) {
    for (const s of starts) {
      if (s.end <= r.from || s.start >= r.to || s.count > r.open) continue;
      out = unknownIn(out, Math.max(s.start, r.from), Math.min(s.end, r.to), r.count);
    }
  }
  return out;
}

/** `flattenRanges` input with each range's count replaced by its start offset. */
export function rangeStarts(functions: readonly FunctionCoverage[]): FunctionCoverage[] {
  return functions.map((f) => ({ ...f, ranges: f.ranges.map((r) => ({ ...r, count: r.startOffset })) }));
}

/** Segments with `count` inside `[from, to)` become UNKNOWN; others are split at the edges only. */
function unknownIn(segments: readonly Segment[], from: number, to: number, count: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.end <= from || s.start >= to || s.count !== count) {
      out.push(s);
      continue;
    }
    if (s.start < from) out.push({ start: s.start, end: from, count: s.count });
    out.push({ start: Math.max(s.start, from), end: Math.min(s.end, to), count: UNKNOWN });
    if (s.end > to) out.push({ start: to, end: s.end, count: s.count });
  }
  return out;
}

function isWordAt(source: string, mask: Uint8Array, i: number, word: string): boolean {
  if (mask[i] !== CODE || source.slice(i, i + word.length) !== word) return false;
  const before = i > 0 ? source[i - 1] : ' ';
  const after = source[i + word.length] ?? ' ';
  return !/[\w$.]/.test(before as string) && !/[\w$]/.test(after);
}

function nextCode(mask: Uint8Array, from: number): number | undefined {
  for (let i = from; i < mask.length; i++) if (mask[i] !== 0) return i;
  return undefined;
}

/** Open brace offset → its closing brace, for braces that are punctuation (not in strings). */
function matchBraces(source: string, mask: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (mask[i] !== PUNCT) continue;
    if (source[i] === '{') stack.push(i);
    else if (source[i] === '}') {
      const open = stack.pop();
      if (open !== undefined) out.set(open, i);
    }
  }
  return out;
}

function matchParen(source: string, mask: Uint8Array, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (mask[i] !== PUNCT) continue;
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return i;
  }
  return undefined;
}
