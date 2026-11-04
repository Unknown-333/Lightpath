import { CODE, isJumpOnly, PUNCT, previousCode } from './code-mask.js';
import { countAt, type Segment } from './flatten.js';
import type { LineIndex } from './line-index.js';

/**
 * Line number (1-based) → execution count. A count of 0 means "known not to have run";
 * a missing line means "no coverage information" (blank lines, comments, gaps between functions).
 */
export type LineCounts = Map<number, number>;

/**
 * Converts flattened segments to per-line counts for a script whose positions match the
 * original file (plain JS, or TypeScript run with Node's type stripping).
 *
 * A line takes the maximum count of the segments under its code characters (D-149): names,
 * keywords, literals, operators. Brackets, braces, parentheses, `;` and `,` count only on a line
 * with nothing else, and comments never count. Maximum, not sum: a loop body that ran 10 times
 * shows 10, not 10 plus the loop test's 11. A line whose code is only `break` or `continue` takes
 * the lower of its count and the count of the code before it: V8 ends a `case` clause's range
 * where its `break` starts, so the `break` of an untaken case would read as run.
 */
export function rangesToLines(segments: readonly Segment[], index: LineIndex): LineCounts {
  const out: LineCounts = new Map();
  if (segments.length === 0) return out;
  const mask = index.mask;
  const source = index.source;
  const first = segments[0] as Segment;
  const last = segments[segments.length - 1] as Segment;
  for (let line = index.lineOf(first.start); line < index.lineCount; line++) {
    const content = index.content(line);
    if (!content) continue;
    const [from, to] = content;
    if (from >= last.end) break;
    let code: number | undefined;
    let punct: number | undefined;
    let codeStart = -1;
    // Each run of same-class characters is looked up once; a run can cross segments.
    let i = from;
    while (i < to) {
      const kind = mask[i] as number;
      let j = i + 1;
      while (j < to && mask[j] === kind) j++;
      if (kind === CODE || kind === PUNCT) {
        const count = maxOver(segments, i, j);
        if (count !== undefined) {
          if (kind === CODE) {
            if (codeStart < 0) codeStart = i;
            if (code === undefined || count > code) code = count;
          } else if (punct === undefined || count > punct) punct = count;
        }
      }
      i = j;
    }
    let count = code ?? punct;
    if (count === undefined) continue;
    if (code !== undefined && codeStart >= 0 && isJumpOnly(source, mask, from, to)) {
      const before = previousCode(mask, codeStart);
      const prior = before === undefined ? undefined : countAt(segments, before);
      if (prior !== undefined && prior >= 0 && prior < count) count = prior;
    }
    out.set(line + 1, count);
  }
  return out;
}

/** The highest count of the segments overlapping `[from, to)`, or undefined if none does. */
function maxOver(segments: readonly Segment[], from: number, to: number): number | undefined {
  // Binary search for the first segment ending after `from`.
  let lo = 0;
  let hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((segments[mid] as Segment).end <= from) lo = mid + 1;
    else hi = mid;
  }
  let best: number | undefined;
  for (let k = lo; k < segments.length; k++) {
    const s = segments[k] as Segment;
    if (s.start >= to) break;
    if (s.count < 0) continue; // unknown (D-153)
    if (best === undefined || s.count > best) best = s.count;
  }
  return best;
}

/** Keeps only lines that ran, sorted by line number. */
export function coveredLines(counts: LineCounts): { line: number; count: number }[] {
  return [...counts]
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([line, count]) => ({ line, count }));
}
