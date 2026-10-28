import type { FunctionCoverage } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { countAt, flattenRanges } from '../src/flatten.js';

const fn = (ranges: [number, number, number][], name = 'f'): FunctionCoverage => ({
  functionName: name,
  isBlockCoverage: true,
  ranges: ranges.map(([startOffset, endOffset, count]) => ({ startOffset, endOffset, count })),
});

describe('flattenRanges', () => {
  it('lets the innermost range win', () => {
    // Shape from the nested-closure spike: outer [299-490]x1 with an untaken block [454-489]x0.
    expect(
      flattenRanges([
        fn([
          [299, 490, 1],
          [454, 489, 0],
        ]),
      ]),
    ).toEqual([
      { start: 299, end: 454, count: 1 },
      { start: 454, end: 489, count: 0 },
      { start: 489, end: 490, count: 1 },
    ]);
  });

  it('handles nested functions reported as separate entries', () => {
    const segs = flattenRanges([fn([[0, 100, 1]], 'outer'), fn([[20, 40, 0]], 'unusedCb')]);
    expect(segs).toEqual([
      { start: 0, end: 20, count: 1 },
      { start: 20, end: 40, count: 0 },
      { start: 40, end: 100, count: 1 },
    ]);
  });

  it('handles three levels and a loop body that ran more often than its function', () => {
    // From the coverage spike: a:[869-971]x2 [924-959]x20 [937-957]x10
    expect(
      flattenRanges([
        fn([
          [869, 971, 2],
          [924, 959, 20],
          [937, 957, 10],
        ]),
      ]),
    ).toEqual([
      { start: 869, end: 924, count: 2 },
      { start: 924, end: 937, count: 20 },
      { start: 937, end: 957, count: 10 },
      { start: 957, end: 959, count: 20 },
      { start: 959, end: 971, count: 2 },
    ]);
  });

  it('leaves gaps between top-level functions uncovered', () => {
    const segs = flattenRanges([fn([[0, 10, 1]], 'a'), fn([[20, 30, 3]], 'b')]);
    expect(countAt(segs, 15)).toBeUndefined();
    expect(countAt(segs, 25)).toBe(3);
  });

  it('merges adjacent segments with equal counts', () => {
    expect(flattenRanges([fn([[0, 10, 1]], 'a'), fn([[10, 20, 1]], 'b')])).toEqual([
      { start: 0, end: 20, count: 1 },
    ]);
  });

  it('ignores empty ranges and clamps ranges that overflow their parent', () => {
    expect(
      flattenRanges([
        fn([
          [0, 10, 1],
          [5, 5, 9],
          [8, 15, 0],
        ]),
      ]),
    ).toEqual([
      { start: 0, end: 8, count: 1 },
      { start: 8, end: 10, count: 0 },
    ]);
  });

  it('matches a brute-force innermost-wins reference on random nested trees', () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let trial = 0; trial < 300; trial++) {
      const ranges: [number, number, number][] = [];
      const grow = (start: number, end: number, depth: number) => {
        ranges.push([start, end, rand(5)]);
        if (depth > 3 || end - start < 4) return;
        let cursor = start + 1;
        while (cursor < end - 2 && rand(3) > 0) {
          const s = cursor + rand(Math.max(1, (end - cursor) >> 1));
          const e = Math.min(end - 1, s + 1 + rand(Math.max(1, end - s - 1)));
          if (e <= s) break;
          grow(s, e, depth + 1);
          cursor = e;
        }
      };
      grow(0, 60 + rand(60), 0);

      const segs = flattenRanges([fn(ranges)]);
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i]?.start).toBeGreaterThanOrEqual(segs[i - 1]?.end ?? 0);
      }
      const max = Math.max(...ranges.map((r) => r[1]));
      for (let off = 0; off < max; off++) {
        // Innermost = the containing range that starts last (ties: the shorter one).
        let best: [number, number, number] | undefined;
        for (const r of ranges) {
          if (r[0] <= off && off < r[1] && (!best || r[0] > best[0] || (r[0] === best[0] && r[1] <= best[1])))
            best = r;
        }
        expect(countAt(segs, off)).toBe(best?.[2]);
      }
    }
  });
});
