import type { Trace } from '@lightpath/protocol';
import { describe, expect, it } from 'vitest';
import { ago, bucketize, countLabel, HEAT_BUCKETS, pathKey, replayOrder } from '../src/heat.js';

describe('bucketize', () => {
  it('puts each line in its log2 bucket and caps at the hottest bucket', () => {
    const buckets = bucketize([
      { line: 1, count: 1 },
      { line: 2, count: 3 },
      { line: 3, count: 4 },
      { line: 4, count: 10_000 },
    ]);
    expect(buckets).toHaveLength(HEAT_BUCKETS);
    expect(buckets[0]?.map((l) => l.line)).toEqual([1]);
    expect(buckets[1]?.map((l) => l.line)).toEqual([2]);
    expect(buckets[2]?.map((l) => l.line)).toEqual([3]);
    expect(buckets[HEAT_BUCKETS - 1]?.map((l) => l.line)).toEqual([4]);
  });
});

describe('countLabel', () => {
  it('hides single hits', () => {
    expect(countLabel(1)).toBe('');
    expect(countLabel(12)).toBe('  × 12');
  });
});

describe('replayOrder', () => {
  it('orders files by when the collectors first saw them', () => {
    const file = (path: string, firstSeenAt: number) => ({
      path,
      collector: 'node' as const,
      lines: [],
      firstSeenAt,
    });
    const trace: Trace = {
      id: 't_abc123def456',
      label: 'x',
      origin: 'browser',
      startedAt: 0,
      files: [file('server/b.ts', 20), file('web/a.tsx', 10), file('server/a.ts', 20)],
      requests: [],
      dropped: [],
    };
    expect(replayOrder(trace).map((f) => f.path)).toEqual(['web/a.tsx', 'server/a.ts', 'server/b.ts']);
  });
});

describe('ago and pathKey', () => {
  it('formats relative times', () => {
    expect(ago(0, 12_400)).toBe('12s ago');
    expect(ago(0, 5 * 60_000)).toBe('5m ago');
    expect(ago(0, 3 * 3_600_000)).toBe('3h ago');
  });

  it('compares Windows paths case-insensitively', () => {
    expect(pathKey('C:\\Repo\\A.ts', 'win32')).toBe(pathKey('c:/repo/a.ts', 'win32'));
    expect(pathKey('/repo/A.ts', 'linux')).not.toBe(pathKey('/repo/a.ts', 'linux'));
  });
});
