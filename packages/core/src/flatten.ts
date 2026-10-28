import type { FunctionCoverage } from '@lightpath-dev/protocol';

/** A half-open byte span `[start, end)` with the execution count of its innermost range. */
export interface Segment {
  start: number;
  end: number;
  count: number;
}

interface Range {
  start: number;
  end: number;
  count: number;
}

/**
 * Flattens one script's nested V8 coverage ranges into sorted, non-overlapping segments.
 *
 * V8 reports a function's whole span first, then blocks inside it with their own counts.
 * At every offset the innermost range's count wins (the same rule c8 uses).
 * Gaps between top-level functions produce no segment, so they read as "unknown", not "not run".
 *
 * Runs in O(n log n) for n ranges. See docs/ARCHITECTURE.md section 4.2.
 */
export function flattenRanges(functions: readonly FunctionCoverage[]): Segment[] {
  const ranges: Range[] = [];
  for (const fn of functions) {
    for (const r of fn.ranges) {
      if (r.endOffset > r.startOffset)
        ranges.push({ start: r.startOffset, end: r.endOffset, count: r.count });
    }
  }
  // Outer ranges first: by start ascending, then by end descending.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  const out: Segment[] = [];
  const stack: Range[] = [];
  let cursor = 0;

  const emit = (start: number, end: number, count: number) => {
    if (end <= start) return;
    const last = out.at(-1);
    if (last && last.end === start && last.count === count) last.end = end;
    else out.push({ start, end, count });
  };

  // Close every open range that ends at or before `pos`, emitting its tail.
  const closeUntil = (pos: number) => {
    let top = stack.at(-1);
    while (top && top.end <= pos) {
      emit(cursor, top.end, top.count);
      cursor = top.end;
      stack.pop();
      top = stack.at(-1);
    }
  };

  for (const r of ranges) {
    closeUntil(r.start);
    const parent = stack.at(-1);
    if (parent) emit(cursor, r.start, parent.count);
    cursor = r.start;
    // A range that pokes out of its parent is malformed; clamp it to the parent.
    const end = parent ? Math.min(r.end, parent.end) : r.end;
    stack.push({ start: r.start, end, count: r.count });
  }
  closeUntil(Number.POSITIVE_INFINITY);
  return out;
}

/**
 * Returns the count of the segment containing `offset`, or `undefined` if no segment does.
 * `segments` must come from {@link flattenRanges} (sorted, non-overlapping).
 */
export function countAt(segments: readonly Segment[], offset: number): number | undefined {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = segments[mid] as Segment;
    if (offset < s.start) hi = mid - 1;
    else if (offset >= s.end) lo = mid + 1;
    else return s.count;
  }
  return undefined;
}
