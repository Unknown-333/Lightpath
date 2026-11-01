import type { FunctionHit, Trace } from '@lightpath-dev/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { fitText, MAX_CHARS } from '../src/budget.js';
import { diffFunctions } from '../src/diff.js';
import { createMcpServer } from '../src/server.js';
import { type ReadSource, sliceTrace } from '../src/slices.js';
import { summarizeTrace } from '../src/summary.js';
import { DESCRIPTIONS, INSTRUCTIONS } from '../src/texts.js';

const fn = (
  over: Partial<FunctionHit> & Pick<FunctionHit, 'path' | 'name' | 'startLine' | 'endLine'>,
): FunctionHit => ({
  collector: 'browser',
  count: 1,
  phase: 0,
  ...over,
});
const hits = (...lines: number[]) => lines.map((line) => ({ line, count: 1 }));

/** A Checkout-shaped trace with three phases. */
const checkout: Trace = {
  id: 't_abc123def456',
  label: 'button: Checkout',
  origin: 'browser',
  startedAt: 1_000,
  endedAt: 1_400,
  files: [
    { path: 'src/Cart.tsx', collector: 'browser', lines: hits(21, 22, 23, 25), firstSeenAt: 1 },
    { path: 'server/routes/orders.ts', collector: 'node', lines: hits(11, 12, 14, 19), firstSeenAt: 2 },
    { path: 'src/poll.ts', collector: 'browser', lines: hits(3), firstSeenAt: 3, background: true },
  ],
  requests: [
    {
      collector: 'node',
      pid: 1,
      method: 'POST',
      path: '/api/orders',
      status: 201,
      durationMs: 3,
      overlapped: false,
    },
  ],
  dropped: [{ reason: 'node_modules', count: 4 }],
  phases: [
    { kind: 'before-request', request: 0 },
    { kind: 'backend', request: 0 },
    { kind: 'after-response' },
  ],
  functions: [
    fn({ path: 'src/Cart.tsx', name: 'checkout', startLine: 21, endLine: 25, notRun: [24], phase: 0 }),
    fn({
      path: 'server/routes/orders.ts',
      collector: 'node',
      name: 'createOrder',
      startLine: 11,
      endLine: 19,
      notRun: [15, 16, 17],
      notRunSpans: [{ line: 12, startColumn: 27, endColumn: 32, text: '?? []' }],
      phase: 1,
    }),
    fn({
      path: 'src/Cart.tsx',
      name: 'checkout',
      startLine: 21,
      endLine: 25,
      count: 0,
      notRun: [21, 22],
      phase: 2,
    }),
    fn({ path: 'src/poll.ts', name: '', startLine: 3, endLine: 3, phase: 2 }),
  ],
};

describe('summarizeTrace (design section 6.1)', () => {
  it('prints the header, then each phase with its files and functions', () => {
    expect(summarizeTrace(checkout)).toBe(
      [
        'Trace t_abc123def456: button: Checkout',
        'request: POST /api/orders → 201 (node, 3 ms)',
        '',
        'before POST /api/orders [browser]',
        '  src/Cart.tsx',
        '    checkout 21-25 ×1 not run: 24',
        'POST /api/orders → 201 [node, 3 ms]',
        '  server/routes/orders.ts',
        '    createOrder 11-19 ×1 not run: 15-17',
        'after the response [browser]',
        '  src/Cart.tsx',
        '    checkout 21-25 resumed not run: 21-22',
        '  src/poll.ts (background)',
        '    (anonymous) 3 ×1',
        'hidden: 4 node_modules',
      ].join('\n'),
    );
  });

  it('cuts a 2,000-file trace to 16,000 characters and names the top dropped file', () => {
    const files: Trace['files'] = [];
    const functions: FunctionHit[] = [];
    for (let i = 0; i < 2000; i++) {
      const path = `src/feature-${String(i).padStart(4, '0')}/component.tsx`;
      // File i has i+1 hits, so feature-1999 ranks highest and feature-0000 lowest.
      files.push({ path, collector: 'browser', lines: [{ line: 10, count: i + 1 }], firstSeenAt: i });
      functions.push(
        fn({
          path,
          name: `render${i}`,
          startLine: 10,
          endLine: 40,
          count: i + 1,
          notRun: [12, 13, 20],
          phase: 0,
        }),
      );
    }
    const big: Trace = { ...checkout, files, functions, phases: [{ kind: 'browser' }], requests: [] };
    const text = summarizeTrace(big);
    expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
    const last = text.split('\n').at(-1) ?? '';
    expect(last).toMatch(
      /^not shown: \d+ files, \d+ functions \([\d,]+ chars\)\. Call get_trace with traceId "t_abc123def456" and file "src\/feature-\d{4}\/component\.tsx" to see one\.$/,
    );
    // The highest-ranked files stay; the top dropped one is the next in rank.
    expect(text).toContain('src/feature-1999/component.tsx');
    expect(text).not.toContain('src/feature-0000/component.tsx');
    const kept = (text.match(/^ {2}src\/feature-/gm) ?? []).length;
    const top = /file "src\/feature-(\d{4})/.exec(last)?.[1];
    expect(Number(top)).toBe(2000 - kept - 1);
  });

  it('keeps any tool text under the cap with a cut line (fitText)', () => {
    const long = Array.from({ length: 3000 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    const out = fitText(long, MAX_CHARS, 't_abc123def456');
    expect(out.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(out.split('\n').at(-1)).toMatch(/^not shown: the rest/);
  });
});

describe('sliceTrace (design section 6.3)', () => {
  const orders = [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'export function createOrder(req, res) {', // 11
    '  const lines = body.lines ?? [];', //       12
    '  // a comment', //                          13
    '  if (lines.length === 0) {', //             14
    "    res.status(400).json({ error: 'Your cart is empty.' });", // 15
    '    return;', //                             16
    '  }', //                                     17
    '', //                                        18
    '  saveOrder(lines);', //                     19
  ].join('\n');
  const reader =
    (mtimeMs: number, text = orders): ReadSource =>
    async (path) =>
      path === 'server/routes/orders.ts' ? { text, mtimeMs } : undefined;

  it('prints executed lines with numbers, folds not-run lines, and names untaken blocks', async () => {
    expect(await sliceTrace(checkout, { file: 'orders' }, reader(500))).toBe(
      [
        'server/routes/orders.ts (trace t_abc123def456, phase POST /api/orders → 201)',
        '  11  export function createOrder(req, res) {',
        '  12    const lines = body.lines ?? [];  // not run: ?? []',
        '  14    if (lines.length === 0) {',
        '      // not run: lines 15-17',
        '  19    saveOrder(lines);',
      ].join('\n'),
    );
  });

  it('warns when the file changed after the trace started', async () => {
    const text = await sliceTrace(checkout, { function: 'createOrder' }, reader(5_000));
    expect(text.split('\n')[0]).toBe(
      'warning: server/routes/orders.ts changed after this trace; line numbers may not match. Rerun the action for a fresh trace.',
    );
  });

  it('pages a long file under 16,000 characters, with the call for the next page', async () => {
    const n = 2500;
    const text = Array.from(
      { length: n },
      (_, i) => `  const v${i} = compute(${i}); // ${'y'.repeat(30)}`,
    ).join('\n');
    const long: Trace = {
      ...checkout,
      files: [
        {
          path: 'server/routes/orders.ts',
          collector: 'node',
          lines: hits(...Array.from({ length: n }, (_, i) => i + 1)),
          firstSeenAt: 1,
        },
      ],
      functions: [
        fn({
          path: 'server/routes/orders.ts',
          collector: 'node',
          name: 'huge',
          startLine: 1,
          endLine: n,
          phase: 1,
        }),
      ],
    };
    const read = reader(500, text);
    const p1 = await sliceTrace(long, { file: 'server/routes/orders.ts' }, read);
    expect(p1.length).toBeLessThanOrEqual(MAX_CHARS);
    const pages = Number(/page 1 of (\d+)\./.exec(p1)?.[1]);
    expect(pages).toBeGreaterThan(1);
    expect(p1.split('\n').at(-1)).toBe(
      `page 1 of ${pages}. Call get_trace with traceId "t_abc123def456", file "server/routes/orders.ts", page 2 for the next.`,
    );
    // Every line shows up exactly once over all pages.
    const seen: number[] = [];
    for (let p = 1; p <= pages; p++) {
      const page = await sliceTrace(long, { file: 'server/routes/orders.ts', page: p }, read);
      expect(page.length).toBeLessThanOrEqual(MAX_CHARS);
      for (const m of page.matchAll(/^ *(\d+) {2}/gm)) seen.push(Number(m[1]));
    }
    expect(seen).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });

  it('lists candidates for a file that matches several, and for an unknown function', async () => {
    expect(await sliceTrace(checkout, { file: '.ts' }, reader(500))).toMatch(/^"\.ts" matches 3 files/);
    expect(await sliceTrace(checkout, { function: 'nope' }, reader(500))).toMatch(/^No function "nope"/);
  });
});

describe('diffFunctions (design section 6.4)', () => {
  it('matches functions by name after a fix shifts their lines', () => {
    const before: Trace = {
      ...checkout,
      id: 't_000000000001',
      requests: [{ ...checkout.requests[0], status: 500 } as Trace['requests'][number]],
      functions: [
        fn({
          path: 'server/routes/orders.ts',
          collector: 'node',
          name: 'createOrder',
          startLine: 11,
          endLine: 30,
          notRun: [26, 27, 28],
          phase: 1,
        }),
        fn({
          path: 'server/routes/orders.ts',
          collector: 'node',
          name: 'fail',
          startLine: 40,
          endLine: 44,
          phase: 1,
        }),
        fn({ path: 'src/money.ts', name: 'formatCents', startLine: 3, endLine: 5, count: 2, phase: 2 }),
      ],
    };
    // The fix added two lines above createOrder: every line moved by 2.
    const after: Trace = {
      ...checkout,
      id: 't_000000000002',
      functions: [
        fn({
          path: 'server/routes/orders.ts',
          collector: 'node',
          name: 'createOrder',
          startLine: 13,
          endLine: 32,
          notRun: [24, 25, 26],
          phase: 1,
        }),
        fn({ path: 'src/money.ts', name: 'formatCents', startLine: 3, endLine: 5, count: 7, phase: 2 }),
      ],
    };
    expect(diffFunctions(before, after)).toBe(
      [
        'Trace t_000000000001 (button: Checkout) → t_000000000002 (button: Checkout):',
        'requests:',
        '  POST /api/orders 500 → 201',
        'ran only in t_000000000001:',
        '  server/routes/orders.ts fail (line 40) ×1',
        'branches changed (each side in its own line numbers):',
        '  server/routes/orders.ts createOrder (line 11 → 13): now runs 26-28; no longer runs 24-26',
        'call counts changed:',
        '  src/money.ts formatCents (line 3): ×2 → ×7',
      ].join('\n'),
    );
    expect(diffFunctions(after, after)).toMatch(/none: both traces ran the same functions and branches$/);
  });
});

describe('server texts (design section 3, D-119)', () => {
  it('keeps instructions under 1,000, each description under 300, and tools/list at most 4,000', async () => {
    expect(INSTRUCTIONS.length).toBe(730); // 665 plus build 5's run_request clause
    for (const d of Object.values(DESCRIPTIONS)) expect(d.length).toBeLessThan(300);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ workspaceRoot: process.cwd() });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      expect(client.getInstructions()).toBe(INSTRUCTIONS);
      const list = await client.listTools();
      for (const t of list.tools) expect(t.description?.length ?? 0).toBeLessThan(300);
      const size = JSON.stringify(list).length;
      expect(size).toBeLessThanOrEqual(4000);
    } finally {
      await client.close();
    }
  });
});
