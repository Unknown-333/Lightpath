import type { Segment } from './flatten.js';
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
 * A line takes the maximum count of any segment that overlaps its non-whitespace content.
 * Maximum, not sum: a loop body that ran 10 times shows 10, not 10 plus the loop test's 11.
 */
export function rangesToLines(segments: readonly Segment[], index: LineIndex): LineCounts {
  const out: LineCounts = new Map();
  for (const seg of segments) {
    let line = index.lineOf(seg.start);
    while (line < index.lineCount && index.lineStart(line) < seg.end) {
      const content = index.content(line);
      if (content && seg.start < content[1] && seg.end > content[0]) {
        const key = line + 1;
        const prev = out.get(key);
        if (prev === undefined || seg.count > prev) out.set(key, seg.count);
      }
      line++;
    }
  }
  return out;
}

/** Keeps only lines that ran, sorted by line number. */
export function coveredLines(counts: LineCounts): { line: number; count: number }[] {
  return [...counts]
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([line, count]) => ({ line, count }));
}
