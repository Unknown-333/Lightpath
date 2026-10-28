import { describe, expect, it } from 'vitest';
import { flattenRanges } from '../src/flatten.js';
import { LineIndex } from '../src/line-index.js';
import { coveredLines, rangesToLines } from '../src/lines.js';
import { captureCoverage } from './helpers/capture.js';

/** Lines that ran, as `line:count` strings, for readable assertions. */
function ran(source: string, url: string, act: Parameters<typeof captureCoverage>[2]): string[] {
  const cov = captureCoverage(source, url, act);
  const counts = rangesToLines(flattenRanges(cov.functions), new LineIndex(source));
  return coveredLines(counts).map((l) => `${l.line}:${l.count}`);
}

describe('LineIndex', () => {
  it('finds lines and content bounds', () => {
    const idx = new LineIndex('a\n  b  \n\n\tc');
    expect(idx.lineCount).toBe(4);
    expect(idx.lineOf(0)).toBe(0);
    expect(idx.lineOf(4)).toBe(1);
    expect(idx.content(1)).toEqual([4, 5]);
    expect(idx.content(2)).toBeUndefined();
    expect(idx.lineOf(100)).toBe(3);
  });
});

describe('rangesToLines with real V8 coverage', () => {
  it('marks the taken branch and not the untaken one', () => {
    const source = [
      'exports.checkout = function checkout(total) {', // 1
      '  if (total > 100) {', //                           2
      "    return 'free shipping';", //                    3
      '  }', //                                            4
      "  return 'standard';", //                           5
      '};', //                                             6
      'exports.unused = function unused() {', //           7
      '  return 1;', //                                    8
      '};', //                                             9
    ].join('\n');
    const lines = ran(source, 'file:///repo/branch.js', (e) => e.checkout?.(50));
    // Line 4's `}` closes the untaken block, so V8 counts it 0 along with line 3.
    expect(lines).toEqual(['1:1', '2:1', '5:1', '6:1']);
  });

  it('reports loop bodies with their iteration counts', () => {
    const source = [
      'exports.sum = function sum(items) {', //       1
      '  let total = 0;', //                           2
      '  for (const item of items) {', //              3
      '    total += item.price;', //                   4
      '  }', //                                        5
      '  return total;', //                            6
      '};', //                                         7
    ].join('\n');
    const lines = ran(source, 'file:///repo/loop.js', (e) =>
      e.sum?.([{ price: 1 }, { price: 2 }, { price: 3 }]),
    );
    expect(lines).toContain('4:3');
    expect(lines).toContain('6:1');
  });

  it('uses UTF-16 offsets so non-ASCII text before code does not shift lines', () => {
    const source = [
      "const label = '🛒 カート 购物车';", // 1  (astral + CJK characters)
      'exports.greet = function greet(on) {', // 2
      '  if (on) {', //                          3
      '    return label;', //                    4
      '  }', //                                  5
      "  return '';", //                         6
      '};', //                                   7
    ].join('\n');
    const lines = ran(source, 'file:///repo/unicode.js', (e) => e.greet?.(true));
    // Line 6 comes after the early return, so V8 counts it 0. Closing braces of blocks that ran
    // (lines 5 and 7) count as run. If offsets were UTF-8 bytes, every line here would shift.
    expect(lines).toEqual(['2:1', '3:1', '4:1', '5:1', '7:1']);
  });
});
