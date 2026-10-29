import type { ScriptCoverage } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { PERIODIC_WINDOWS, PeriodicFunctions } from '../src/noise.js';

const script = (fns: [name: string, start: number, count: number][]): ScriptCoverage => ({
  scriptId: '1',
  url: 'http://localhost:5173/src/a.ts',
  functions: fns.map(([functionName, startOffset, count]) => ({
    functionName,
    isBlockCoverage: true,
    ranges: [{ startOffset, endOffset: startOffset + 10, count }],
  })),
});
const hashOf = () => 'h1';

describe('PeriodicFunctions', () => {
  it(`marks a function periodic after ${PERIODIC_WINDOWS} background windows`, () => {
    const p = new PeriodicFunctions();
    for (let i = 0; i < PERIODIC_WINDOWS - 1; i++) p.observeBackground([script([['tick', 0, 1]])], hashOf);
    expect(p.isPeriodic('h1', 0)).toBe(false);
    p.observeBackground([script([['tick', 0, 1]])], hashOf);
    expect(p.isPeriodic('h1', 0)).toBe(true);
  });

  it("ignores functions that didn't run, unknown scripts, and other hashes", () => {
    const p = new PeriodicFunctions();
    for (let i = 0; i < 5; i++) {
      p.observeBackground([script([['idle', 0, 0]])], hashOf);
      p.observeBackground([script([['x', 20, 1]])], () => undefined);
    }
    expect(p.isPeriodic('h1', 0)).toBe(false);
    expect(p.isPeriodic('h1', 20)).toBe(false);
    for (let i = 0; i < 5; i++) p.observeBackground([script([['tick', 0, 1]])], hashOf);
    expect(p.isPeriodic('h2', 0)).toBe(false); // a hot reload changes the hash
  });

  it('splits an action into the functions that are not periodic', () => {
    const p = new PeriodicFunctions();
    for (let i = 0; i < 5; i++) p.observeBackground([script([['tick', 0, 1]])], hashOf);
    const action = script([
      ['tick', 0, 1],
      ['onClick', 40, 1],
    ]);
    expect(p.foreground(action, 'h1')?.functions.map((f) => f.functionName)).toEqual(['onClick']);
    const quiet = script([['onClick', 40, 1]]);
    expect(p.foreground(quiet, 'h1')).toBe(quiet); // unchanged object: nothing to split
  });

  it('forgets the oldest functions past its limit', () => {
    const p = new PeriodicFunctions(2);
    for (let i = 0; i < 5; i++) p.observeBackground([script([['a', 0, 1]])], hashOf);
    for (let i = 0; i < 5; i++) {
      p.observeBackground(
        [
          script([
            ['b', 10, 1],
            ['c', 20, 1],
          ]),
        ],
        hashOf,
      );
    }
    expect(p.isPeriodic('h1', 0)).toBe(false);
    expect(p.isPeriodic('h1', 20)).toBe(true);
  });
});
