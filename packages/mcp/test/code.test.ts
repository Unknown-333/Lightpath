import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type RunningDaemon, startDaemon } from '@lightpath-dev/daemon';
import type { FunctionHit, Trace } from '@lightpath-dev/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_CHARS } from '../src/budget.js';
import { CODE_LEGEND, withCode } from '../src/code.js';
import { redactSource } from '../src/redact.js';
import { createMcpServer } from '../src/server.js';
import type { ReadSource } from '../src/slices.js';
import { summarizeTrace } from '../src/summary.js';

// D-145: trace answers end with the code of the lines that ran, within 16,000 characters, and
// hard-coded keys and tokens in that code never come back.

const fn = (over: Partial<FunctionHit> & Pick<FunctionHit, 'path' | 'name' | 'startLine' | 'endLine'>) =>
  ({ collector: 'browser', count: 1, phase: 0, ...over }) as FunctionHit;
const hits = (lines: number[], count = 1) => lines.map((line) => ({ line, count }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const ledgerSrc = [
  "import { invoices } from '../data.ts';", //                       1
  '', //                                                              2
  'let summaryCache = null;', //                                      3
  '', //                                                              4
  'export function getSummary() {', //                                5
  '  if (summaryCache) return summaryCache;', //                      6
  '  const summary = { outstandingCents: 0 };', //                    7
  '  for (const inv of invoices) {', //                               8
  '    summary.outstandingCents += inv.amountCents;', //              9
  '  }', //                                                          10
  '  summaryCache = summary;', //                                    11
  '  return summary;', //                                            12
  '}', //                                                            13
].join('\n');
const routeSrc = [
  "import { getSummary } from '../services/ledger.ts';", //          1
  'export function listInvoices(_req, res) {', //                    2
  '  res.json({ summary: getSummary() });', //                       3
  '}', //                                                             4
].join('\n');

/** A trace where getSummary took its early return: lines 7-12 didn't run. */
const cached: Trace = {
  id: 't_code00000001',
  label: 'button: Mark as paid',
  origin: 'browser',
  startedAt: 10_000,
  endedAt: 10_100,
  files: [
    { path: 'server/routes/invoices.ts', collector: 'node', lines: hits([2, 3]), firstSeenAt: 1 },
    { path: 'server/services/ledger.ts', collector: 'node', lines: hits([5, 6], 3), firstSeenAt: 2 },
    { path: 'src/missing.tsx', collector: 'browser', lines: hits([1]), firstSeenAt: 3 },
  ],
  requests: [],
  dropped: [],
  phases: [{ kind: 'browser' }],
  functions: [
    fn({
      path: 'server/routes/invoices.ts',
      collector: 'node',
      name: 'listInvoices',
      startLine: 2,
      endLine: 4,
    }),
    fn({
      path: 'server/services/ledger.ts',
      collector: 'node',
      name: 'getSummary',
      startLine: 5,
      endLine: 13,
      count: 3,
      notRun: range(7, 12),
    }),
    fn({ path: 'src/missing.tsx', name: 'Missing', startLine: 1, endLine: 1 }),
  ],
};

const readerOf =
  (files: Record<string, string>, mtimeMs = 1): ReadSource =>
  async (path) =>
    path in files ? { text: files[path] as string, mtimeMs } : undefined;
const summary = (t: Trace) => (max: number) => summarizeTrace(t, [], max);

describe('withCode (D-145)', () => {
  it('adds the executed lines, folds lines that did not run, and puts the most-used file first', async () => {
    const read = readerOf({ 'server/services/ledger.ts': ledgerSrc, 'server/routes/invoices.ts': routeSrc });
    const text = await withCode(cached, read, summary(cached));
    const code = text.slice(text.indexOf(`\n\n${CODE_LEGEND}`) + 2);
    expect(text.startsWith(summarizeTrace(cached))).toBe(true);
    expect(code).toBe(
      [
        CODE_LEGEND,
        // 6 hits beat 2: ledger.ts first.
        'server/services/ledger.ts',
        '   5  export function getSummary() {',
        '   6    if (summaryCache) return summaryCache;',
        '      // not run: lines 7-12',
        'server/routes/invoices.ts',
        '   2  export function listInvoices(_req, res) {',
        '   3    res.json({ summary: getSummary() });',
      ].join('\n'),
    );
    // src/missing.tsx can't be read: the summary names it, the code section leaves it out.
    expect(text).toContain('  src/missing.tsx');
    expect(code).not.toContain('missing');
  });

  it('is the summary alone when no file can be read', async () => {
    expect(await withCode(cached, readerOf({}), summary(cached))).toBe(summarizeTrace(cached));
    expect(await withCode(cached, undefined, summary(cached))).toBe(summarizeTrace(cached));
  });

  it('leaves out a file changed after the trace, and says so', async () => {
    const read = readerOf({ 'server/services/ledger.ts': ledgerSrc }, 20_000);
    const text = await withCode(cached, read, summary(cached));
    expect(text).not.toContain('getSummary() {\n');
    expect(text.split('\n').at(-1)).toBe(
      'code not shown for server/services/ledger.ts: changed after this trace. Rerun the action for a fresh trace.',
    );
  });

  it('keeps a 2,000-file trace with every file readable at most 16,000 characters', async () => {
    const files: Trace['files'] = [];
    const functions: FunctionHit[] = [];
    const sources: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      const path = `src/feature-${String(i).padStart(4, '0')}/component.tsx`;
      // File i has i+1 hits per line, so feature-1999 is the most used.
      files.push({ path, collector: 'browser', lines: hits(range(10, 30), i + 1), firstSeenAt: i });
      functions.push(
        fn({ path, name: `render${i}`, startLine: 10, endLine: 40, count: i + 1, notRun: range(31, 40) }),
      );
      sources[path] = range(1, 40)
        .map((l) => `  const v${l} = compute${i}(${l}); // ${'y'.repeat(20)}`)
        .join('\n');
    }
    const big: Trace = { ...cached, id: 't_code00002000', files, functions };
    const text = await withCode(big, readerOf(sources), summary(big));
    expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
    const at = text.indexOf(`\n\n${CODE_LEGEND}\n`);
    expect(at).toBeGreaterThan(0);
    // The summary keeps at least half, and says what it left out.
    expect(at).toBeGreaterThanOrEqual(MAX_CHARS / 2 - 400);
    expect(text.slice(0, at)).toMatch(/\nnot shown: \d+ files, \d+ functions/);
    const code = text.slice(at + 2).split('\n');
    // Most-used first: the code starts with feature-1999.
    expect(code[1]).toBe('src/feature-1999/component.tsx');
    expect(code[2]).toBe(`  10    const v10 = compute1999(10); // ${'y'.repeat(20)}`);
    expect(code.at(-1)).toMatch(
      /^code not shown: \d{4} files \([\d,]+ chars\)\. Call get_trace with traceId "t_code00002000" and file "src\/feature-\d{4}\/component\.tsx" to see one\.$/,
    );
  });

  it('cuts the most-used file at a line when it alone is too long, and says where the rest is', async () => {
    const n = 2000;
    const long: Trace = {
      ...cached,
      files: [{ path: 'src/huge.ts', collector: 'browser', lines: hits(range(1, n)), firstSeenAt: 1 }],
      functions: [fn({ path: 'src/huge.ts', name: 'huge', startLine: 1, endLine: n })],
    };
    const src = range(1, n)
      .map((l) => `  step(${l});`)
      .join('\n');
    const text = await withCode(long, readerOf({ 'src/huge.ts': src }), summary(long));
    expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(text).toContain('   1    step(1);');
    expect(text.split('\n').at(-1)).toBe(
      '  ... cut here: get_trace with traceId "t_code00000001" and file "src/huge.ts" shows all of it',
    );
  });

  it('respects a smaller cap (run_action with compareTo leaves room for the diff)', async () => {
    const read = readerOf({ 'server/services/ledger.ts': ledgerSrc, 'server/routes/invoices.ts': routeSrc });
    const text = await withCode(cached, read, summary(cached), 600);
    expect(text.length).toBeLessThanOrEqual(600);
  });
});

// The fake secrets are built at run time, so no secret scanner flags this file.
const FAKE = {
  namedKey: `lp-fake-${'key'}-7c1e9a3b5d2f`,
  stripeKey: ['sk', 'live', 'Zq8T2mW4rL6pN1vX9bC3dF5h'].join('_'),
  token: `tok_${'fake'}_93jf02kd83nf`,
  bearer: `fakeBearer${'Q2x9Lm3Np7Rt'}`,
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJsaWdodHBhdGgtdGVzdCJ9', 'ZmFrZS1zaWduYXR1cmU'].join('.'),
};
/** A fixture with one hard-coded secret per rule, and a line that must stay readable. */
const configSrc = [
  'export async function connect(url) {', //                                  1
  `  const apiKey = "${FAKE.namedKey}";`, //                                   2
  `  const stripe = '${FAKE.stripeKey}';`, //                                  3
  `  const token = '${FAKE.token}';`, //                                       4
  `  const header = 'Bearer ${FAKE.bearer}';`, //                              5
  `  const preview = '${FAKE.jwt}';`, //                                       6
  '  const session = await getSession(url);', //                              7
  '  return fetch(url, { headers: { header }, body: [apiKey, stripe, token, preview, session] });', // 8
  '}', //                                                                      9
].join('\n');
const expectNoSecrets = (text: string) => {
  for (const [name, value] of Object.entries(FAKE)) expect(text, name).not.toContain(value);
};

describe('redactSource (D-145)', () => {
  it('hides each seeded secret, keeps line numbers, and leaves ordinary code alone', () => {
    const out = redactSource(configSrc);
    expectNoSecrets(out);
    expect(out.split('\n')).toHaveLength(9);
    expect(out.split('\n').slice(1, 6)).toEqual([
      '  const apiKey = "[redacted]";',
      "  const stripe = '[redacted]';",
      "  const token = '[redacted]';",
      "  const header = 'Bearer [redacted]';",
      "  const preview = '[redacted]';",
    ]);
    expect(out).toContain('  const session = await getSession(url);');
    for (const line of [
      'const sessionId = req.params.id;',
      '<li key={item.id}>',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text with a template placeholder
      'const auth = `Bearer ${token}`;',
      "if (password === '') return;",
      'const tokens = text.split(" ");',
    ])
      expect(redactSource(line)).toBe(line);
    expect(redactSource("fetch('/api?api_key=abc123&page=2')")).toBe(
      "fetch('/api?api_key=[redacted]&page=2')",
    );
    expect(redactSource('headers: { "Authorization": "Basic dXNlcjpwYXNz" }')).toBe(
      'headers: { "Authorization": "[redacted]" }',
    );
    const pem = [
      'const k = `-----BEGIN PRIVATE KEY-----',
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
      '-----END PRIVATE KEY-----`;',
    ];
    expect(redactSource(pem.join('\n')).split('\n')).toEqual(['const k = `[redacted]', '', '`;']);
  });
});

// Through the MCP server against a real daemon, with the fixture on disk in the workspace root.
describe('trace answers through the MCP server (D-145)', () => {
  let root: string;
  let daemon: RunningDaemon;
  let client: Client;
  const configTrace = (id: string): Trace => ({
    id,
    label: 'button: Connect',
    origin: 'browser',
    startedAt: Date.now(),
    endedAt: Date.now() + 10,
    files: [{ path: 'src/config.ts', collector: 'browser', lines: hits(range(1, 8)), firstSeenAt: 1 }],
    requests: [],
    dropped: [],
    phases: [{ kind: 'browser' }],
    functions: [fn({ path: 'src/config.ts', name: 'connect', startLine: 1, endLine: 9 })],
  });
  let n = 0;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'lightpath-code-'));
    const file = join(root, 'src', 'config.ts');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, configSrc);
    // Older than any trace this test records.
    await utimes(file, new Date(1_000), new Date(1_000));
    daemon = await startDaemon({ workspaceRoots: [root] });
    daemon.setActionRunner(async () => {
      n += 1;
      const id = `t_${String(n).padStart(12, '0')}`;
      daemon.store.put(configTrace(id));
      return {
        ok: true,
        traceId: id,
        boundary: 'press',
        settled: 'quiet',
        pageUrl: 'http://localhost:5173/',
        tagged: [],
        warnings: [],
      };
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ workspaceRoot: root });
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
  });

  afterAll(async () => {
    await client?.close();
    daemon?.setActionRunner(undefined);
    await daemon?.close();
    await rm(root, { recursive: true, force: true });
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return res.content.map((c) => c.text).join('\n');
  };

  it('get_trace with file returns the lines with no seeded secret', async () => {
    const action = await call('run_action', { target: 'button "Connect"' });
    const id = /^Trace (t_\d{12})/.exec(action)?.[1];
    const slice = await call('get_trace', { traceId: id, file: 'src/config.ts' });
    expect(slice).toContain('   7    const session = await getSession(url);');
    expectNoSecrets(slice);
  });

  it('returns the code with run_action, find_code_for_action and get_trace, and no seeded secret', async () => {
    const action = await call('run_action', { target: 'button "Connect"' });
    const id = /^Trace (t_\d{12})/.exec(action)?.[1];
    expect(action).toContain(`\n\n${CODE_LEGEND}\nsrc/config.ts\n   1  export async function connect(url) {`);
    expect(action).toContain('   7    const session = await getSession(url);');
    expect(action).toContain('   2    const apiKey = "[redacted]";');
    const found = await call('find_code_for_action', { action: 'Connect' });
    const summary = await call('get_trace', { traceId: id });
    const slice = await call('get_trace', { traceId: id, file: 'src/config.ts' });
    expect(found).toContain(CODE_LEGEND);
    expect(summary).toContain(CODE_LEGEND);
    expect(slice).toContain("   5    const header = 'Bearer [redacted]';");
    for (const text of [action, found, summary, slice]) {
      expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
      expectNoSecrets(text);
    }
  });

  it('redacts a filled value that is also a literal in the code (rule 6)', async () => {
    const text = await call('run_action', {
      target: 'button "Connect"',
      fill: [{ target: 'textbox "Key"', value: 'getSession' }],
    });
    expect(text).toContain('   7    const session = await [redacted](url);');
  });
});
