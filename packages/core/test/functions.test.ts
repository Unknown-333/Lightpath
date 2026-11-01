import { readFileSync } from 'node:fs';
import type { DecodedSourceMap, EncodedSourceMap } from '@jridgewell/trace-mapping';
import type { ScriptCoverage } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { mapFunctions } from '../src/functions.js';
import { mapScript } from '../src/pipeline.js';
import type { ResolveContext } from '../src/resolve.js';

// The same real V8 fixtures as fixtures.test.ts (hand-checked lines), now read at function level.
interface Fixture {
  coverage: ScriptCoverage;
  source: string;
  sourceMap?: EncodedSourceMap | DecodedSourceMap;
}
const load = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const ctx: ResolveContext = {
  workspaceRoots: ['/repo'],
  devServers: [{ origin: 'http://localhost:5173', root: '/repo/shop' }],
};

function functionsOf(name: string) {
  const f = load(name);
  const input = {
    coverage: f.coverage,
    source: f.source,
    ...(f.sourceMap ? { sourceMap: f.sourceMap } : {}),
  };
  return mapFunctions(input, mapScript(input, ctx).files, ctx);
}

const brief = (fns: ReturnType<typeof functionsOf>) =>
  fns.map(
    (f) =>
      `${f.name || '(anonymous)'} ${f.startLine}-${f.endLine} x${f.count} not run: ${f.notRun.join(',')}`,
  );

describe('mapFunctions (D-116)', () => {
  it('reads ranges, counts and an untaken block inside one line under type stripping (ts-strip)', () => {
    const fns = functionsOf('ts-strip');
    expect(brief(fns)).toEqual([
      'priceLines 9-19 x1 not run: ',
      'applyCoupon 21-25 x1 not run: ',
      'run 27-35 x1 not run: ',
    ]);
    // Line 22 ran (the `if`), but its `return totalCents` didn't; line 23's `: 0` arm didn't either.
    expect(fns[1]?.path).toBe('samples/ts-strip.ts');
    expect(fns[1]?.notRunSpans).toEqual([
      { line: 22, startColumn: 13, endColumn: 31, text: 'return totalCents;' },
      { line: 23, startColumn: 44, endColumn: 47, text: ': 0' },
    ]);
  });

  it('maps through a source map, with not-run lines from the file counts (tsx-transform)', () => {
    expect(brief(functionsOf('tsx-transform'))).toEqual([
      'Order 10-13 x1 not run: ',
      '<instance_members_initializer> 11-12 x1 not run: ',
      'pay 15-22 x1 not run: 20,21',
      'get label 24-33 x1 not run: 28,29,30,31',
      'run 36-40 x1 not run: ',
    ]);
  });

  it("lists nested functions and names the shop Cart's untaken blocks inside lines (vite-jsx)", () => {
    const fns = functionsOf('vite-jsx');
    expect(brief(fns)).toEqual([
      'Cart 11-50 x4 not run: 29',
      '(anonymous) 16-19 x2 not run: ',
      '(anonymous) 17-17 x2 not run: ',
      'checkout 21-33 x1 not run: 29',
    ]);
    expect(fns.flatMap((f) => f.notRunSpans.map((s) => `${s.line}: ${s.text}`))).toEqual([
      "47: ? 'error' : ''",
      '18: : 0',
    ]);
  });

  it('leaves out the top-level script and functions that did not run', () => {
    const fns = functionsOf('plain-js');
    expect(fns.some((f) => f.startLine === 1)).toBe(false);
    expect(fns.find((f) => f.name === 'shippingCents')).toMatchObject({
      startLine: 4,
      count: 2,
      notRun: [6, 7],
    });
    expect(fns.some((f) => f.name === 'clear')).toBe(false);
  });
});
