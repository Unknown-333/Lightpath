import type { Trace } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { describeSummaries, describeTrace, diffTraces, lineRanges } from '../src/format.js';

const hits = (...lines: number[]) => lines.map((line) => ({ line, count: 1 }));

const checkout: Trace = {
  id: 't_abc123def456',
  label: 'button: Checkout',
  origin: 'browser',
  startedAt: 0,
  files: [
    {
      path: 'web/src/Cart.tsx',
      collector: 'browser',
      lines: [...hits(10, 11, 12, 20), { line: 21, count: 3 }],
      firstSeenAt: 0,
    },
    { path: 'server/routes/orders.ts', collector: 'node', lines: hits(5, 6), firstSeenAt: 1 },
  ],
  requests: [
    {
      collector: 'node',
      pid: 1,
      method: 'POST',
      path: '/api/orders',
      status: 201,
      durationMs: 12.4,
      overlapped: false,
    },
  ],
  dropped: [{ reason: 'node_modules', count: 14 }],
};

describe('lineRanges', () => {
  it.each([
    [[], ''],
    [[4], '4'],
    [[1, 2, 3, 7, 9, 10], '1-3, 7, 9-10'],
  ])('%j → %s', (lines, out) => {
    expect(lineRanges(hits(...lines))).toBe(out);
  });
});

describe('describeTrace', () => {
  it('lists requests, files with line ranges and hot spots, and what was hidden', () => {
    expect(describeTrace(checkout)).toBe(
      [
        'Trace t_abc123def456: button: Checkout',
        '  request: POST /api/orders → 201 (node, 12 ms)',
        '  web/src/Cart.tsx [browser] lines 10-12, 20-21 (max 3 hits)',
        '  server/routes/orders.ts [node] lines 5-6',
        '  not shown: 14 node_modules',
      ].join('\n'),
    );
  });
});

describe('describeSummaries', () => {
  it('explains what to do when there are no traces', () => {
    expect(describeSummaries([])).toMatch(/Click something/);
  });
});

describe('diffTraces', () => {
  it('lists lines unique to each trace', () => {
    const loggedOut: Trace = {
      ...checkout,
      id: 't_000000000002',
      label: 'button: Checkout (logged out)',
      files: [
        { path: 'web/src/Cart.tsx', collector: 'browser', lines: hits(10, 11, 12, 30), firstSeenAt: 0 },
      ],
    };
    expect(diffTraces(checkout, loggedOut)).toBe(
      [
        'Lines that ran in only one of t_abc123def456 (button: Checkout) and t_000000000002 (button: Checkout (logged out)):',
        '  server/routes/orders.ts: only in A: 5-6',
        '  web/src/Cart.tsx: only in A: 20-21',
        '  web/src/Cart.tsx: only in B: 30',
      ].join('\n'),
    );
  });
});
