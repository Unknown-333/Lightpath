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

describe('summarizeTrace folds backend files that ran in 3 or more requests (D-141)', () => {
  const request = (path: string): Trace['requests'][number] => ({
    collector: 'node',
    pid: 1,
    method: 'GET',
    path,
    status: 200,
    durationMs: 5,
    overlapped: false,
  });
  const node = (over: Parameters<typeof fn>[0]) => fn({ collector: 'node', ...over });

  it('shows a shared file once, with request counts, and keeps per-request files apart', () => {
    const paths = ['/api/a', '/api/b', '/api/c', '/api/d'];
    const many: Trace = {
      id: 't_fold00000001',
      label: 'button: Login',
      origin: 'browser',
      startedAt: 0,
      endedAt: 10,
      files: [
        { path: 'backend/app.js', collector: 'node', lines: hits(10, 11, 20), firstSeenAt: 1 },
        { path: 'backend/routes/a.js', collector: 'node', lines: hits(5), firstSeenAt: 2 },
      ],
      requests: paths.map(request),
      dropped: [],
      phases: paths.map((_, i) => ({ kind: 'backend', request: i })),
      functions: [
        ...paths.map((_, i) =>
          node({
            path: 'backend/app.js',
            name: 'logger',
            startLine: 10,
            endLine: 14,
            notRun: i === 0 ? [12, 13] : [13],
            phase: i,
          }),
        ),
        node({ path: 'backend/app.js', name: 'auth', startLine: 20, endLine: 22, phase: 0 }),
        node({ path: 'backend/routes/a.js', name: 'getA', startLine: 5, endLine: 9, phase: 0 }),
      ],
    };
    expect(summarizeTrace(many)).toBe(
      [
        'Trace t_fold00000001: button: Login',
        'request: GET /api/a → 200 (node, 5 ms)',
        'request: GET /api/b → 200 (node, 5 ms)',
        'request: GET /api/c → 200 (node, 5 ms)',
        'request: GET /api/d → 200 (node, 5 ms)',
        '',
        'GET /api/a → 200 [node, 5 ms]',
        '  backend/routes/a.js',
        '    getA 5-9 ×1',
        'GET /api/b → 200 [node, 5 ms]',
        'GET /api/c → 200 [node, 5 ms]',
        'GET /api/d → 200 [node, 5 ms]',
        'in 3 or more requests [backend, shown once]',
        '  backend/app.js (in 4 of 4 requests)',
        '    logger 10-14 ×4 not run: 13',
        '    auth 20-22 ×1 (in 1)',
        'folded: 1 backend file that ran in 3 or more of the 4 requests is shown once under "in 3 or more requests", not under each request (78 chars saved). Call get_trace with traceId "t_fold00000001" and file "backend/app.js" to see one file\'s lines.',
      ].join('\n'),
    );
    // Two requests are too few to fold: the file stays under each.
    const two: Trace = {
      ...many,
      requests: many.requests.slice(0, 2),
      phases: many.phases?.slice(0, 2),
      functions: many.functions?.filter((f) => f.phase < 2),
    };
    expect(summarizeTrace(two)).not.toContain('folded:');
    expect(summarizeTrace(two).match(/^ {2}backend\/app\.js$/gm)).toHaveLength(2);
  });

  it('keeps the files the unfolded text would keep, so a capped trace gets shorter', () => {
    // 13 requests that each run the same 4 middleware files and one route file of their own,
    // plus 300 browser files: over the cap before folding (the tududi Login trace's shape).
    const n = 13;
    const middleware = [
      'app.js',
      'middleware/queryLogger.js',
      'middleware/rateLimiter.js',
      'services/perms.js',
    ];
    const functions: FunctionHit[] = [];
    const files: Trace['files'] = [];
    for (const [k, m] of middleware.entries()) {
      files.push({ path: `backend/${m}`, collector: 'node', lines: hits(1), firstSeenAt: k });
      for (let i = 0; i < n; i++)
        for (let f = 0; f < 6; f++)
          functions.push(
            node({
              path: `backend/${m}`,
              name: `mw${f}`,
              startLine: 10 * f + 1,
              endLine: 10 * f + 9,
              phase: i,
            }),
          );
    }
    for (let i = 0; i < n; i++) {
      files.push({ path: `backend/routes/r${i}.js`, collector: 'node', lines: hits(1), firstSeenAt: 10 + i });
      functions.push(
        node({ path: `backend/routes/r${i}.js`, name: `route${i}`, startLine: 1, endLine: 9, phase: i }),
      );
    }
    for (let i = 0; i < 300; i++) {
      const path = `frontend/c${String(i).padStart(3, '0')}.tsx`;
      files.push({ path, collector: 'browser', lines: [{ line: 1, count: 1 }], firstSeenAt: 100 + i });
      functions.push(
        fn({ path, name: `Component${i}`, startLine: 1, endLine: 40, notRun: [5, 6], phase: n }),
      );
    }
    const big: Trace = {
      ...checkout,
      id: 't_fold00000002',
      files,
      requests: Array.from({ length: n }, (_, i) => request(`/api/r${i}`)),
      phases: [
        ...Array.from({ length: n }, (_, i) => ({ kind: 'backend' as const, request: i })),
        { kind: 'after-response' },
      ],
      functions,
      dropped: [],
    };
    const text = summarizeTrace(big);
    expect(text).toContain('folded: 4 backend files that ran in 3 or more of the 13 requests');
    // Every route file is kept under its own request.
    for (let i = 0; i < n; i++) expect(text).toContain(`  backend/routes/r${i}.js\n    route${i} 1-9 ×1`);
    // The cut drops the same browser files as without folding, so the text is shorter than the cap.
    const notShown = /not shown: (\d+) files/.exec(text);
    expect(Number(notShown?.[1])).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(MAX_CHARS - 5000);
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
        // Build 4 (design 6.4 item 1, D-132): the 500 was a failed request in A.
        'problems: errors 0 → 0, failed requests 1 → 0',
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

/** Kiro CLI's `tool_load` answer for one tool, as it appears in a benchmark transcript (D-140). */
function kiroToolLoad(tool: {
  name: string;
  description?: string | undefined;
  inputSchema: unknown;
}): string {
  const strip = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(strip);
    if (!s || typeof s !== 'object') return s;
    return Object.fromEntries(
      Object.entries(s)
        .filter(([k]) => k !== '$schema' && k !== 'additionalProperties')
        .map(([k, v]) => [k, strip(v)]),
    );
  };
  const note =
    'These tools are now loaded for the rest of this session. To RUN one, call tool_call with { "tool_id": "namespace::tool", "arguments": { ... } } (use the tool_id shown for each result, and arguments matching its input_schema). Do not call tool_load again for tools you have already loaded.';
  const loaded = [
    {
      tool_id: `lightpath::${tool.name}`,
      description: tool.description,
      input_schema: strip(tool.inputSchema),
    },
  ];
  return JSON.stringify({ loaded, not_found: [], note }, null, 2);
}

describe('run_action load size (D-140)', () => {
  it("is shorter than 0.1.0's 2,409 characters in Kiro's tool_load step", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ workspaceRoot: process.cwd() });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const tool = (await client.listTools()).tools.find((t) => t.name === 'run_action');
      expect(tool).toBeDefined();
      // 2,409: the tool_load text of 0.1.0's run_action in the benchmark run b04-with-1 (steps audit, PR #59).
      if (tool) expect(kiroToolLoad(tool).length).toBeLessThan(2409);
    } finally {
      await client.close();
    }
  });
});

describe('server texts (design section 3, D-119)', () => {
  it('keeps instructions under 1,000, each description under 300, and tools/list at most 4,000', async () => {
    // 730 plus the bug-report trigger (D-134) is 896; the fix check through compareTo (D-144) is 888.
    // The cap stays 1,000.
    expect(INSTRUCTIONS.length).toBe(888);
    expect(INSTRUCTIONS).toContain('compareTo "last"');
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
