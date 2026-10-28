import type { IngestMessage } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { Correlator } from '../src/correlator.js';
import { MemoryStore } from '../src/store.js';

const source = [
  'export function createOrder(cart) {', // 1
  '  if (cart.items.length === 0) {', //    2
  "    throw new Error('empty');", //       3
  '  }', //                                 4
  '  return { id: 1 };', //                 5
  '}', //                                   6
].join('\n');
const url = 'file:///repo/server/orders.js';
const blockStart = source.indexOf('{', source.indexOf('if ('));
const blockEnd = source.indexOf('}', blockStart) + 1;

function setup() {
  const store = new MemoryStore();
  const correlator = new Correlator(store, { workspaceRoots: ['/repo'] });
  const send = (m: IngestMessage, agent = 'node-1') => correlator.ingest(agent, m);
  send({
    type: 'hello',
    protocolVersion: 1,
    kind: 'node',
    pid: 1,
    processTitle: 'server',
    cwd: '/repo',
    runtime: { name: 'node', version: '24' },
  });
  send({ type: 'scripts', scripts: [{ scriptId: '9', url, hash: 'h1', length: source.length }] });
  send({ type: 'source', scriptId: '9', hash: 'h1', url, source });
  return { store, send };
}

const delta = (traceId?: string): IngestMessage => ({
  type: 'delta',
  phase: 'action',
  startedAt: 1000,
  endedAt: 1012,
  request: { method: 'POST', path: '/api/orders', status: 201 },
  ...(traceId ? { traceId } : {}),
  coverage: [
    {
      scriptId: '9',
      url,
      functions: [
        {
          functionName: 'createOrder',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 0, endOffset: source.length, count: 1 },
            { startOffset: blockStart, endOffset: blockEnd, count: 0 },
          ],
        },
      ],
    },
  ],
});

describe('Correlator', () => {
  it('maps a backend delta to workspace lines, skipping the untaken branch', () => {
    const { store, send } = setup();
    send(delta());
    const [summary] = store.list();
    const trace = summary && store.get(summary.id);
    expect(trace).toMatchObject({ origin: 'backend', label: 'POST /api/orders' });
    expect(trace?.files).toEqual([
      {
        path: 'server/orders.js',
        collector: 'node',
        firstSeenAt: 1000,
        lines: [1, 2, 5, 6].map((line) => ({ line, count: 1 })),
      },
    ]);
    expect(trace?.requests).toEqual([
      {
        collector: 'node',
        pid: 1,
        method: 'POST',
        path: '/api/orders',
        status: 201,
        durationMs: 12,
        overlapped: false,
      },
    ]);
  });

  it('attaches backend deltas to the browser trace with the same id', () => {
    const { store, send } = setup();
    send(
      {
        type: 'traceStart',
        traceId: 't_abc123def456',
        label: 'button: Checkout',
        target: { name: 'Checkout' },
        at: 900,
      },
      'browser',
    );
    send(delta('t_abc123def456'));
    send({ type: 'traceEnd', traceId: 't_abc123def456', at: 1400, settled: 'quiet' }, 'browser');
    expect(store.list()).toHaveLength(1);
    expect(store.get('t_abc123def456')).toMatchObject({
      origin: 'browser',
      label: 'button: Checkout',
      startedAt: 900,
      endedAt: 1400,
      files: [{ path: 'server/orders.js' }],
    });
  });

  it('keeps a browser trace open until traceEnd, even after its backend delta', () => {
    const { store, send } = setup();
    send(
      { type: 'traceStart', traceId: 't_abc123def456', label: 'button: Checkout', target: {}, at: 900 },
      'browser',
    );
    send(delta('t_abc123def456'));
    expect(store.get('t_abc123def456')?.endedAt).toBeUndefined();
    send({ type: 'traceEnd', traceId: 't_abc123def456', at: 1400, settled: 'quiet' }, 'browser');
    expect(store.get('t_abc123def456')?.endedAt).toBe(1400);
  });

  it('merges a traceStart that arrives after the backend delta', () => {
    const { store, send } = setup();
    send(delta('t_abc123def456'));
    send(
      { type: 'traceStart', traceId: 't_abc123def456', label: 'button: Checkout', target: {}, at: 900 },
      'browser',
    );
    send({ type: 'traceEnd', traceId: 't_abc123def456', at: 1400, settled: 'quiet' }, 'browser');
    expect(store.get('t_abc123def456')).toMatchObject({
      label: 'button: Checkout',
      origin: 'browser',
      startedAt: 900,
      files: [{ path: 'server/orders.js' }],
    });
  });

  it('counts scripts it cannot map instead of guessing', () => {
    const { store, send } = setup();
    send({
      type: 'delta',
      phase: 'action',
      startedAt: 1,
      endedAt: 2,
      coverage: [
        { scriptId: '99', url: 'file:///repo/server/unknown.js', functions: [] },
        { scriptId: '98', url: 'file:///repo/node_modules/x/index.js', functions: [] },
      ],
    });
    const trace = store.get(store.list()[0]?.id ?? 't_000000000000');
    expect(trace?.dropped).toEqual(
      expect.arrayContaining([
        { reason: 'no-source', count: 1 },
        { reason: 'node_modules', count: 1 },
      ]),
    );
  });

  it('ignores background deltas', () => {
    const { store, send } = setup();
    send({ ...delta(), phase: 'background' } as IngestMessage);
    expect(store.list()).toHaveLength(0);
  });

  it('accepts Python line reports', () => {
    const store = new MemoryStore();
    const correlator = new Correlator(store, { workspaceRoots: ['C:/repo'] });
    correlator.ingest('py-7', {
      type: 'lines',
      traceId: 't_abc123def456',
      pid: 7,
      startedAt: 5,
      endedAt: 9,
      request: { method: 'GET', path: '/api/items', status: 200 },
      files: [{ path: 'C:\\repo\\api\\items.py', lines: [10, 11, 14] }],
    });
    expect(store.get('t_abc123def456')?.files).toEqual([
      {
        path: 'api/items.py',
        collector: 'python',
        firstSeenAt: 5,
        lines: [10, 11, 14].map((line) => ({ line, count: 1 })),
      },
    ]);
  });
});

describe('MemoryStore', () => {
  it('evicts the oldest trace and lists newest first', () => {
    const store = new MemoryStore(2);
    for (const id of ['t_000000000001', 't_000000000002', 't_000000000003']) {
      store.put({ id, label: id, origin: 'backend', startedAt: 0, files: [], requests: [], dropped: [] });
    }
    expect(store.list().map((t) => t.id)).toEqual(['t_000000000003', 't_000000000002']);
    expect(store.get('t_000000000001')).toBeUndefined();
  });
});
