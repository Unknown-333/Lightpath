import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DecodedSourceMap, EncodedSourceMap } from '@jridgewell/trace-mapping';
import type { ScriptCoverage } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import type { LineCounts } from '../src/lines.js';
import { mapScript } from '../src/pipeline.js';

/**
 * Real V8 coverage captured by scripts/capture-fixtures.mjs. The expected lines below were checked
 * by hand against each sample (docs/ROADMAP.md, M1) and must only change after a fresh hand check.
 */
interface Fixture {
  name: string;
  sampleSha256: string;
  coverage: ScriptCoverage;
  source: string;
  sourceMap?: EncodedSourceMap | DecodedSourceMap;
}

const fixturesDir = new URL('./fixtures/', import.meta.url);
const load = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`${name}.json`, fixturesDir), 'utf8'));
const sample = (file: string) => readFileSync(new URL(`samples/${file}`, fixturesDir), 'utf8');

/** Compresses line counts into runs like `4-5:2`, `10:1` (consecutive lines with the same count). */
function runs(counts: LineCounts): string[] {
  const out: string[] = [];
  const lines = [...counts].sort((a, b) => a[0] - b[0]);
  let i = 0;
  while (i < lines.length) {
    const [from, count] = lines[i] as [number, number];
    let to = from;
    while (i + 1 < lines.length && lines[i + 1]?.[0] === to + 1 && lines[i + 1]?.[1] === count) {
      to++;
      i++;
    }
    out.push(from === to ? `${from}:${count}` : `${from}-${to}:${count}`);
    i++;
  }
  return out;
}

const cases: { name: string; file: string; expected: string[] }[] = [
  {
    // shippingCents ran twice, never with free shipping (6-7); 'drone' threw, so `return rate` ran once.
    // add() ran 3 times, its else 2 times; the loop body 2 times; the catch block ran. clear() (31-33)
    // never ran, and a V8 delta only lists functions that ran, so it has no data rather than 0.
    name: 'plain-js',
    file: 'plain-js.mjs',
    expected: [
      '4-5:2',
      '6-7:0',
      '8-9:2',
      '10:1',
      '11:2',
      '14:1',
      '16-18:3',
      '19:2',
      '20-21:3',
      '23-24:1',
      '25-27:2',
      '28-29:1',
      '36-47:1',
    ],
  },
  {
    // Type-only lines have no coverage. Three items: one `continue` ('gone'), two priced.
    name: 'ts-strip',
    file: 'ts-strip.ts',
    expected: ['9-10:1', '11-13:3', '14-15:1', '16-17:2', '18-19:1', '21-25:1', '27-35:1'],
  },
  {
    // greet ran 3 times: the fallback once ('xx'), the normal return twice. Emoji and Nepali text
    // before the code must not shift any line.
    name: 'non-ascii',
    file: 'non-ascii.mjs',
    expected: ['4-6:3', '7-8:1', '9:2', '10:3', '12-14:1'],
  },
  {
    // Mapped back through tsx's inline source map. pay(true) skipped the failure path (20-21); only the
    // Paid case ran (28-31 dark). The enum and class bodies ran at module load, so they have no data.
    name: 'tsx-transform',
    file: 'tsx-transform.ts',
    expected: ['10-13:1', '15-19:1', '20-21:0', '22:1', '24-27:1', '28-31:0', '32-33:1', '36-40:1'],
  },
];

describe.each(cases)('fixture $name', ({ name, file, expected }) => {
  const fixture = load(name);

  it('was captured from the current sample', () => {
    // If this fails, the sample changed: re-run scripts/capture-fixtures.mjs and hand-check again.
    expect(createHash('sha256').update(sample(file)).digest('hex')).toBe(fixture.sampleSha256);
  });

  it('maps to the hand-checked lines', () => {
    const result = mapScript(
      {
        coverage: fixture.coverage,
        source: fixture.source,
        ...(fixture.sourceMap ? { sourceMap: fixture.sourceMap } : {}),
      },
      { workspaceRoots: ['/repo'] },
    );
    expect([...result.dropped]).toEqual([]);
    expect([...result.files.keys()]).toEqual([`samples/${file}`]);
    expect(runs(result.files.get(`samples/${file}`) ?? new Map())).toEqual(expected);
  });
});
