import type { FunctionHit, Trace } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { mergeTraces } from '../src/merge.js';

const fn = (over: Partial<FunctionHit> & Pick<FunctionHit, 'path' | 'name' | 'startLine' | 'endLine'>) =>
  ({ collector: 'browser', count: 1, phase: 0, ...over }) as FunctionHit;

/** A click that posts to /api/cart, with its browser and backend phases. */
function cartClick(id: string, status: number, extra = false): Trace {
  const requests: Trace['requests'] = [
    {
      collector: 'node',
      pid: 1,
      method: 'POST',
      path: '/api/cart',
      status,
      durationMs: 4,
      overlapped: false,
    },
  ];
  if (extra)
    requests.push({
      collector: 'node',
      pid: 1,
      method: 'GET',
      path: '/api/stock',
      status: 200,
      durationMs: 2,
      overlapped: false,
    });
  return {
    id,
    label: 'button: Add to cart',
    origin: 'browser',
    startedAt: 1,
    endedAt: 2,
    files: [
      { path: 'src/App.tsx', collector: 'browser', lines: [{ line: 15, count: 1 }], firstSeenAt: 1 },
      { path: 'server/cart.ts', collector: 'node', lines: [{ line: 3, count: 1 }], firstSeenAt: 2 },
    ],
    requests,
    dropped: [{ reason: 'node_modules', count: 2 }],
    phases: [
      { kind: 'before-request', request: 0 },
      { kind: 'backend', request: 0 },
      ...(extra ? [{ kind: 'backend' as const, request: 1 }] : []),
      { kind: 'after-response' },
    ],
    functions: [
      fn({ path: 'src/App.tsx', name: 'addToCart', startLine: 15, endLine: 24, notRun: [18, 19], phase: 0 }),
      fn({
        path: 'server/cart.ts',
        collector: 'node',
        name: 'add',
        startLine: 3,
        endLine: 9,
        notRun: [5],
        phase: 1,
      }),
      ...(extra
        ? [
            fn({
              path: 'server/stock.ts',
              collector: 'node',
              name: 'stock',
              startLine: 1,
              endLine: 4,
              phase: 2,
            }),
          ]
        : []),
    ],
  };
}

describe('mergeTraces (D-142)', () => {
  it('matches requests and phases, adds up calls and hits, and keeps the last run id and status', () => {
    const merged = mergeTraces([cartClick('t_000000000001', 201), cartClick('t_000000000002', 200, true)]);
    expect(merged.id).toBe('t_000000000002');
    expect(merged.requests.map((r) => `${r.method} ${r.path} ${r.status}`)).toEqual([
      'POST /api/cart 200',
      'GET /api/stock 200',
    ]);
    expect(merged.phases).toEqual([
      { kind: 'before-request', request: 0 },
      { kind: 'backend', request: 0 },
      { kind: 'after-response' },
      { kind: 'backend', request: 1 },
    ]);
    const add = merged.functions?.find((f) => f.name === 'add');
    expect(add).toMatchObject({ count: 2, notRun: [5], phase: 1 });
    expect(merged.functions?.find((f) => f.name === 'stock')).toMatchObject({ count: 1, phase: 3 });
    expect(merged.files.find((f) => f.path === 'src/App.tsx')?.lines).toEqual([{ line: 15, count: 2 }]);
    expect(merged.dropped).toEqual([{ reason: 'node_modules', count: 4 }]);
  });

  it('counts a line as not run only when no run ran it, and leaves its inputs alone', () => {
    const a = cartClick('t_000000000001', 201);
    const b = cartClick('t_000000000002', 201);
    const fb = b.functions?.[0];
    if (fb) fb.notRun = [19, 20];
    const merged = mergeTraces([a, b]);
    expect(merged.functions?.[0]?.notRun).toEqual([19]);
    expect(a.functions?.[0]?.notRun).toEqual([18, 19]);
    expect(a.functions?.[0]?.count).toBe(1);
  });
});
