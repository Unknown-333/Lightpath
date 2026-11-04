import type { IngestMessage, Trace } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { Correlator } from '../src/correlator.js';
import { MemoryStore } from '../src/store.js';

// Phases and functions per trace (D-116, design section 5.3).
const ui = [
  'export function checkout() {', //       1
  "  return fetch('/api/orders');", //      2
  '}', //                                   3
  'export function showResult(ok) {', //   4
  '  if (!ok) {', //                        5
  "    return 'failed';", //                6
  '  }', //                                 7
  "  return 'done';", //                    8
  '}', //                                   9
].join('\n');
const api = [
  'export function createOrder() {', //   1
  '  return 1;', //                         2
  '}', //                                   3
  'export function listItems() {', //     4
  '  return [];', //                        5
  '}', //                                   6
].join('\n');
const uiUrl = 'file:///repo/web/cart.js';
const apiUrl = 'file:///repo/server/orders.js';
const T = 't_abc123def456';

const fnRange = (src: string, name: string) => {
  const start = src.indexOf(`function ${name}`);
  return { startOffset: start, endOffset: src.indexOf('\n}', start) + 2 };
};
const call = (src: string, name: string, count = 1, zero?: [string, string]) => ({
  functionName: name,
  isBlockCoverage: true,
  ranges: [
    { ...fnRange(src, name), count },
    ...(zero
      ? [{ startOffset: src.indexOf(zero[0]), endOffset: src.indexOf(zero[1]) + zero[1].length, count: 0 }]
      : []),
  ],
});

function setup() {
  const store = new MemoryStore();
  const c = new Correlator(store, { workspaceRoots: ['/repo'] });
  const send = (agent: string, m: IngestMessage) => c.ingest(agent, m);
  send('browser', {
    type: 'hello',
    protocolVersion: 1,
    kind: 'browser',
    pid: 1,
    processTitle: 'browser',
    cwd: '/repo',
    runtime: { name: 'chromium', version: '1' },
  });
  send('node-1', {
    type: 'hello',
    protocolVersion: 1,
    kind: 'node',
    pid: 2,
    processTitle: 'server',
    cwd: '/repo',
    runtime: { name: 'node', version: '24' },
  });
  send('browser', {
    type: 'scripts',
    scripts: [{ scriptId: '1', url: uiUrl, hash: 'u', length: ui.length }],
  });
  send('browser', { type: 'source', scriptId: '1', hash: 'u', url: uiUrl, source: ui });
  send('node-1', {
    type: 'scripts',
    scripts: [{ scriptId: '7', url: apiUrl, hash: 'a', length: api.length }],
  });
  send('node-1', { type: 'source', scriptId: '7', hash: 'a', url: apiUrl, source: api });
  send('browser', { type: 'traceStart', traceId: T, label: 'button: Checkout', target: {}, at: 1000 });
  return { store, send, trace: () => store.get(T) as Trace };
}

const browserDelta = (
  at: number,
  functions: ReturnType<typeof call>[],
  before?: { method: string; path: string },
): IngestMessage => ({
  type: 'delta',
  traceId: T,
  phase: 'action',
  startedAt: 1000,
  endedAt: at,
  ...(before ? { beforeRequest: before } : {}),
  coverage: [{ scriptId: '1', url: uiUrl, functions }],
});
const backendDelta = (at: number, method: string, path: string, name: string): IngestMessage => ({
  type: 'delta',
  traceId: T,
  phase: 'action',
  startedAt: at,
  endedAt: at + 3,
  request: { method, path, status: 200 },
  coverage: [{ scriptId: '7', url: apiUrl, functions: [call(api, name)] }],
});

const shape = (t: Trace) => ({
  phases: t.phases,
  functions: t.functions?.map(
    (f) =>
      `${f.phase} ${f.path} ${f.name} ${f.startLine}-${f.endLine} x${f.count}${f.notRun ? ` not run ${f.notRun.join(',')}` : ''}`,
  ),
});

describe('phases (D-116)', () => {
  it('orders before-request, backend and after-response for one tagged request', () => {
    const { send, trace } = setup();
    send('browser', browserDelta(1010, [call(ui, 'checkout')], { method: 'POST', path: '/api/orders' }));
    send('node-1', backendDelta(1011, 'POST', '/api/orders', 'createOrder'));
    send('browser', browserDelta(1050, [call(ui, 'showResult', 1, ["{\n    return 'failed'", '  }'])]));
    send('browser', { type: 'traceEnd', traceId: T, at: 1060, settled: 'quiet' });
    expect(shape(trace())).toEqual({
      phases: [
        { kind: 'before-request', request: 0 },
        { kind: 'backend', request: 0 },
        { kind: 'after-response' },
      ],
      functions: [
        '0 web/cart.js checkout 1-3 x1',
        '1 server/orders.js createOrder 1-3 x1',
        '2 web/cart.js showResult 4-9 x1 not run 6,7', // the untaken block's closing brace too
      ],
    });
  });

  it('ties two before-request phases to their own requests, in time order', () => {
    const { send, trace } = setup();
    send('browser', browserDelta(1010, [call(ui, 'checkout')], { method: 'GET', path: '/api/items' }));
    send('browser', browserDelta(1020, [call(ui, 'checkout')], { method: 'POST', path: '/api/orders' }));
    // The second request's backend answers first.
    send('node-1', backendDelta(1021, 'POST', '/api/orders', 'createOrder'));
    send('node-1', backendDelta(1011, 'GET', '/api/items', 'listItems'));
    send('browser', browserDelta(1050, [call(ui, 'showResult')]));
    send('browser', { type: 'traceEnd', traceId: T, at: 1060, settled: 'quiet' });
    const t = trace();
    expect(t.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/orders', 'GET /api/items']);
    expect(t.phases).toEqual([
      { kind: 'before-request', request: 1 },
      { kind: 'backend', request: 1 },
      { kind: 'before-request', request: 0 },
      { kind: 'backend', request: 0 },
      { kind: 'after-response' },
    ]);
    expect(shape(t).functions).toEqual([
      '0 web/cart.js checkout 1-3 x1',
      '1 server/orders.js listItems 4-6 x1',
      '2 web/cart.js checkout 1-3 x1',
      '3 server/orders.js createOrder 1-3 x1',
      '4 web/cart.js showResult 4-9 x1',
    ]);
  });

  it('gives a browser-only action one browser phase, merging its reads', () => {
    const { send, trace } = setup();
    send('browser', browserDelta(1010, [call(ui, 'showResult')])); // a leave read
    send('browser', browserDelta(1050, [call(ui, 'showResult', 2)])); // the closing read
    send('browser', { type: 'traceEnd', traceId: T, at: 1060, settled: 'quiet' });
    expect(shape(trace())).toEqual({
      phases: [{ kind: 'browser' }],
      functions: ['0 web/cart.js showResult 4-9 x3'],
    });
  });

  it('keeps a Python request as a backend phase with its files by line range, and no functions', () => {
    const { send, trace } = setup();
    send('browser', browserDelta(1010, [call(ui, 'checkout')], { method: 'POST', path: '/api/orders' }));
    send('py-1', {
      type: 'lines',
      traceId: T,
      pid: 3,
      startedAt: 1011,
      endedAt: 1014,
      request: { method: 'POST', path: '/api/orders', status: 201 },
      files: [{ path: '/repo/api/orders.py', lines: [12, 13, 15] }],
    });
    send('browser', { type: 'traceEnd', traceId: T, at: 1060, settled: 'quiet' });
    const t = trace();
    expect(t.phases).toEqual([
      { kind: 'before-request', request: 0 },
      { kind: 'backend', request: 0 },
    ]);
    expect(t.functions?.map((f) => f.path)).toEqual(['web/cart.js']);
    expect(t.files.find((f) => f.path === 'api/orders.py')).toMatchObject({ collector: 'python' });
  });
});
