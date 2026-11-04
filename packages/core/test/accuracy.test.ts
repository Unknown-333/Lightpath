import type { SourceMapInput } from '@jridgewell/trace-mapping';
import { describe, expect, it } from 'vitest';
import { mapFunctions } from '../src/functions.js';
import { mapScript } from '../src/pipeline.js';
import { captureCoverage } from './helpers/capture.js';

// Regression tests for the Phase A accuracy audit (scripts/accuracy, D-149, D-150): the four ways a
// line that did not run was shown as run. Real V8 coverage of one call each; every expectation is
// the truth by hand. Each test fails before D-149/D-150 and passes after.

const ctx = { workspaceRoots: ['/repo'] };
const URL = 'file:///repo/accuracy.js';

/** Runs `name(...args)` once and returns line → count for the script, plus its functions. */
function trace(source: string, name: string, ...args: unknown[]) {
  const coverage = captureCoverage(source, URL, (e) => {
    try {
      e[name]?.(...args);
    } catch {
      // A call that throws is part of some scenarios.
    }
  });
  const result = mapScript({ coverage, source }, ctx);
  const lines = result.files.get('accuracy.js') ?? new Map<number, number>();
  const fns = mapFunctions({ coverage, source }, result.files, ctx, result.unknown);
  return { lines, fns, unknown: result.unknown?.get('accuracy.js') ?? new Map<number, number>() };
}

/** The 1-based line holding `text`. */
const lineOf = (source: string, text: string) => source.split('\n').findIndex((l) => l.includes(text)) + 1;

describe('accuracy: a line that did not run is never shown as run', () => {
  it('an else-if never reached is not run (D-149)', () => {
    const src = [
      'exports.grade = function grade(kind) {',
      "  if (kind === 'a') {",
      '    return 1;',
      "  } else if (kind === 'b') {",
      '    return 2;',
      "  } else if (kind === 'c') {",
      '    return 3;',
      '  }',
      '  return 0;',
      '};',
    ].join('\n');
    const { lines } = trace(src, 'grade', 'b');
    expect(lines.get(lineOf(src, "kind === 'b'"))).toBe(1);
    expect(lines.get(lineOf(src, 'return 2'))).toBe(1);
    expect(lines.get(lineOf(src, "kind === 'c'"))).toBe(0);
    expect(lines.get(lineOf(src, 'return 3'))).toBe(0);
  });

  it("an untaken case's break and an untaken default with a trailing comment are not run (D-149)", () => {
    const src = [
      'exports.price = function price(fruit) {',
      '  let cents = 0;',
      '  switch (fruit) {',
      "    case 'apple':",
      '      cents = 50; // apples',
      '      break;',
      "    case 'pear':",
      '      cents = 75;',
      '      break;',
      '    default:',
      '      cents = 99; // anything else',
      '  }',
      '  return cents;',
      '};',
    ].join('\n');
    const { lines } = trace(src, 'price', 'pear');
    const breaks = src.split('\n').flatMap((l, i) => (l.includes('break;') ? [i + 1] : []));
    expect(lines.get(lineOf(src, 'cents = 50'))).toBe(0);
    expect(lines.get(breaks[0] as number)).toBe(0);
    expect(lines.get(lineOf(src, 'cents = 75'))).toBe(1);
    expect(lines.get(breaks[1] as number)).toBe(1);
    expect(lines.get(lineOf(src, 'cents = 99'))).toBe(0);
    expect(lines.get(lineOf(src, 'return cents'))).toBe(1);
  });

  it('the untaken arm of a multi-line ternary and of && is not run, and a comment line has no count (D-149)', () => {
    const src = [
      'exports.label = function label(vip, user) {',
      '  const text = vip',
      "    ? 'gold member'",
      "    : 'guest';",
      '  // a comment inside the function',
      '  const name = (user',
      '    && user.name)',
      "    || 'nobody';",
      '  return text + name;',
      '};',
    ].join('\n');
    const { lines } = trace(src, 'label', true, null);
    expect(lines.get(lineOf(src, "'gold member'"))).toBe(1);
    expect(lines.get(lineOf(src, "'guest'"))).toBe(0);
    expect(lines.has(lineOf(src, 'a comment'))).toBe(false);
    expect(lines.get(lineOf(src, '&& user.name'))).toBe(0);
    expect(lines.get(lineOf(src, "|| 'nobody'"))).toBe(1);
  });

  it('lines after a call that threw are unknown, not run, and say where (D-150)', () => {
    const src = [
      'function mustBePositive(n) {',
      "  if (n <= 0) throw new RangeError('not positive');",
      '  return n;',
      '}',
      'exports.checkQty = function checkQty(n) {',
      '  try {',
      '    const qty = mustBePositive(n);',
      '    const doubled = qty * 2;',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture's own template literal
      '    return `ok ${doubled}`;',
      '  } catch {',
      "    return 'bad quantity';",
      '  }',
      '};',
    ].join('\n');
    const first = lineOf(src, 'const qty');
    const after = [lineOf(src, 'const doubled'), lineOf(src, 'return `ok')];
    const { lines, fns, unknown } = trace(src, 'checkQty', -1);
    expect(lines.get(first)).toBe(1);
    for (const l of after) {
      expect(lines.has(l)).toBe(false);
      expect(unknown.get(l)).toBe(first);
    }
    expect(lines.get(lineOf(src, "'bad quantity'"))).toBe(1);
    const fn = fns.find((f) => f.name === 'checkQty');
    expect(fn?.unknown).toEqual([{ lines: after, threwAfter: first }]);
    expect(fn?.notRun).not.toContain(after[0]);
  });

  it('a try whose catch did not run keeps every count (D-150)', () => {
    const src = [
      'exports.parse = function parse(text) {',
      '  try {',
      '    const n = Number.parseInt(text, 10);',
      '    return n + 1;',
      '  } catch {',
      '    return 0;',
      '  }',
      '};',
    ].join('\n');
    const { lines, unknown } = trace(src, 'parse', '41');
    expect(lines.get(lineOf(src, 'return n + 1'))).toBe(1);
    expect(lines.get(lineOf(src, 'return 0'))).toBe(0);
    expect(unknown.size).toBe(0);
  });

  it('source-mapped: unknown lines and their line map back to the original file (D-150)', () => {
    // The generated script is the original shifted down by two lines, with an identity-per-line map.
    const original = [
      'exports.checkQty = function checkQty(n) {',
      '  try {',
      "    const v = JSON.parse(n > 0 ? '1' : '{');",
      '    const doubled = v * 2;',
      '    return doubled;',
      '  } catch {',
      "    return 'bad';",
      '  }',
      '};',
    ];
    const generated = ['// generated', '// header', ...original].join('\n');
    // One mapping per line: generated line 3 is original line 1, and each next line one more.
    const mappings = `;;AAAA${';AACA'.repeat(original.length - 1)}`;
    const sourceMap: SourceMapInput = { version: 3, sources: ['/repo/src/qty.ts'], names: [], mappings };
    const coverage = captureCoverage(generated, URL, (e) => e.checkQty?.(-1));
    const result = mapScript({ coverage, source: generated, sourceMap }, ctx);
    const lines = result.files.get('src/qty.ts') ?? new Map();
    expect(lines.get(3)).toBe(1);
    expect(lines.has(4)).toBe(false);
    expect(lines.has(5)).toBe(false);
    expect(lines.get(7)).toBe(1);
    expect([...(result.unknown?.get('src/qty.ts') ?? [])].sort()).toEqual([
      [4, 3],
      [5, 3],
    ]);
  });
});
