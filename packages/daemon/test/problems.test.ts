import type { IngestMessage, Trace } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { Correlator } from '../src/correlator.js';
import { MemoryStore } from '../src/store.js';

// Problems to traces, locations to workspace paths (D-121, design section 5.4).
const T = 't_abc123def456';
const url = 'file:///repo/server/orders.js';

function setup() {
  const store = new MemoryStore();
  const c = new Correlator(store, { workspaceRoots: ['/repo'] });
  const send = (agent: string, m: IngestMessage) => c.ingest(agent, m);
  for (const [agent, kind] of [
    ['browser', 'browser'],
    ['node-1', 'node'],
  ] as const) {
    send(agent, {
      type: 'hello',
      protocolVersion: 1,
      kind,
      pid: 1,
      processTitle: agent,
      cwd: '/repo',
      runtime: { name: kind, version: '1' },
    });
  }
  return { store, send, trace: (id = T) => store.get(id) as Trace };
}

const problem = (over: Partial<Extract<IngestMessage, { type: 'problem' }>> = {}): IngestMessage => ({
  type: 'problem',
  traceId: T,
  at: 5,
  kind: 'exception',
  message: 'TypeError: x is undefined',
  ...over,
});

describe('problems', () => {
  it('attach to the open trace with their workspace location, and count in list_traces', () => {
    const { store, send, trace } = setup();
    send('browser', { type: 'traceStart', traceId: T, label: 'button: Checkout', target: {}, at: 1 });
    send('node-1', problem({ kind: 'uncaught', location: { url, line: 12, column: 4 } }));
    send(
      'browser',
      problem({
        kind: 'request-failed',
        message: 'POST /api/orders → 500',
        request: { method: 'POST', path: '/api/orders', status: 500 },
      }),
    );
    send('browser', { type: 'traceEnd', traceId: T, at: 9, settled: 'quiet' });
    expect(trace().problems).toEqual([
      {
        collector: 'node',
        kind: 'uncaught',
        message: 'TypeError: x is undefined',
        at: 5,
        path: 'server/orders.js',
        line: 12,
      },
      {
        collector: 'browser',
        kind: 'request-failed',
        message: 'POST /api/orders → 500',
        at: 5,
        request: { method: 'POST', path: '/api/orders', status: 500 },
      },
    ]);
    expect(store.list()[0]?.problemCount).toBe(2);
  });

  it('keep at most 50, and count the rest', () => {
    const { send, trace } = setup();
    send('browser', { type: 'traceStart', traceId: T, label: 'button: Spam', target: {}, at: 1 });
    for (let i = 0; i < 53; i++) send('browser', problem({ kind: 'console-error', message: `log ${i}` }));
    expect(trace().problems).toHaveLength(50);
    expect(trace().problemsDropped).toBe(3);
  });

  it('drop a browser problem with no trace, and open a backend trace for a crash with an unknown id', () => {
    const { store, send, trace } = setup();
    send('browser', problem({ traceId: 't_000000000009' }));
    send('browser', problem({ traceId: undefined }));
    expect(store.list()).toEqual([]);
    send('node-1', problem({ traceId: 't_000000000008', kind: 'uncaught' }));
    expect(trace('t_000000000008')).toMatchObject({
      origin: 'backend',
      label: 'uncaught error',
      problems: [{ kind: 'uncaught' }],
    });
  });
});
