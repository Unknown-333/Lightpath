import type { IngestBatch, IngestMessage } from '@lightpath-dev/protocol';
import { MAX_MESSAGE_BYTES } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { type Fetch, MAX_BODY_BYTES, Transport } from '../src/transport.js';

const source = (n: number, size: number): IngestMessage => ({
  type: 'source',
  scriptId: String(n),
  hash: `h${n}`,
  url: `file:///app/${n}.js`,
  source: 'x'.repeat(size),
});

/** A fake daemon: records each body, answers with `status(body)`. */
function fakeFetch(status: (body: string) => number = () => 204) {
  const bodies: string[] = [];
  const impl: Fetch = async (_url, init) => {
    const body = String(init?.body);
    bodies.push(body);
    return new Response(null, { status: status(body) });
  };
  return { impl, bodies, batches: () => bodies.map((b) => JSON.parse(b) as IngestBatch) };
}

describe('Transport', () => {
  it('stays below the daemon body limit with room for the envelope', () => {
    expect(MAX_BODY_BYTES).toBeLessThan(MAX_MESSAGE_BYTES - 64 * 1024);
  });

  it('splits batches by size and keeps every message in order', async () => {
    const daemon = fakeFetch();
    const t = new Transport('http://127.0.0.1:1', 'tok', 'node-1', () => {}, daemon.impl, 10_000);
    for (let i = 0; i < 5; i++) t.send(source(i, 3000));
    await t.flush();
    expect(daemon.bodies.length).toBeGreaterThan(1);
    expect(daemon.bodies.every((b) => Buffer.byteLength(b) <= 10_000)).toBe(true);
    const ids = daemon
      .batches()
      .flatMap((b) => b.messages.map((m) => (m.type === 'source' ? m.scriptId : '')));
    expect(ids).toEqual(['0', '1', '2', '3', '4']);
    expect(daemon.batches()[0]).toMatchObject({ protocolVersion: 1, agentId: 'node-1' });
    expect(t.dropped).toBe(0);
  });

  it('drops a single message that can never fit, and sends the rest', async () => {
    const daemon = fakeFetch();
    const logs: string[] = [];
    const t = new Transport('http://127.0.0.1:1', 'tok', 'node-1', (m) => logs.push(m), daemon.impl, 10_000);
    t.send(source(0, 20_000));
    t.send(source(1, 100));
    await t.flush();
    expect(t.dropped).toBe(1);
    expect(logs.join()).toContain('dropped a source message');
    expect(daemon.batches().flatMap((b) => b.messages)).toHaveLength(1);
  });

  it('drops a batch the daemon rejects as too large instead of retrying it forever', async () => {
    const daemon = fakeFetch(() => 413);
    const t = new Transport('http://127.0.0.1:1', 'tok', 'node-1', () => {}, daemon.impl);
    t.send(source(0, 10));
    await t.flush();
    expect(t.pending).toBe(0);
    expect(t.dropped).toBe(1);
  });

  it('keeps messages queued when the daemon is unreachable', async () => {
    const failing: Fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const t = new Transport('http://127.0.0.1:1', 'tok', 'node-1', () => {}, failing);
    t.send(source(0, 10));
    await t.flush();
    expect(t.pending).toBe(1);
    expect(t.dropped).toBe(0);
  });
});
