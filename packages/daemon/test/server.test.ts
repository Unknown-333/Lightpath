import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonToClientMessage, IngestBatch } from '@lightpath-dev/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { findDiscovery, readDiscovery } from '../src/discovery.js';
import { type RunningDaemon, startDaemon } from '../src/server.js';

let root: string;
let daemon: RunningDaemon;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightpath-daemon-'));
  daemon = await startDaemon({ workspaceRoots: [root] });
});

afterEach(async () => {
  await daemon.close();
  await rm(root, { recursive: true, force: true });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${daemon.url}/v1/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${daemon.token}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const batch = (messages: IngestBatch['messages']): IngestBatch => ({
  protocolVersion: 1,
  agentId: 'node-1',
  messages,
});

describe('daemon HTTP', () => {
  it('serves health without auth and writes a valid discovery file', async () => {
    expect(await (await fetch(`${daemon.url}/v1/health`)).json()).toEqual({ ok: true, protocolVersion: 1 });
    expect(await readDiscovery(root)).toMatchObject({
      port: daemon.port,
      token: daemon.token,
      protocolVersion: 1,
    });
  });

  it('finds the discovery file from a subfolder, where lightpath mcp finds it too (D-102)', async () => {
    const sub = join(root, 'src', 'components');
    await mkdir(sub, { recursive: true });
    expect(await readDiscovery(sub)).toBeUndefined();
    expect(await findDiscovery(sub)).toMatchObject({ root, info: { port: daemon.port, pid: process.pid } });
    expect(await findDiscovery(root)).toMatchObject({ root });
  });

  it('rejects ingest without the token, and any request from a web page', async () => {
    expect((await post(batch([]), { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await post(batch([]), { origin: 'http://evil.example' })).status).toBe(403);
  });

  it('rejects malformed batches with 400', async () => {
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ protocolVersion: 1, agentId: 'a', messages: [{ type: 'bogus' }] })).status).toBe(
      400,
    );
  });

  it('accepts a valid batch with 204', async () => {
    const res = await post(
      batch([{ type: 'source', scriptId: '1', hash: 'h', url: 'file:///x.js', source: '' }]),
    );
    expect(res.status).toBe(204);
    expect(daemon.correlator.sourceCount).toBe(1);
  });
});

describe('daemon client WebSocket', () => {
  it('refuses connections without the token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/v1/client?token=nope`);
    const status = await new Promise<number | undefined>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => resolve(undefined));
    });
    expect(status).toBe(401);
  });

  it('pushes a trace to clients when an agent reports a request', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/v1/client?token=${daemon.token}`);
    const messages: DaemonToClientMessage[] = [];
    const gotTrace = new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        const m = JSON.parse(String(data)) as DaemonToClientMessage;
        messages.push(m);
        if (m.type === 'trace') resolve();
      });
    });
    await new Promise((resolve) => ws.once('open', resolve));

    const source = 'export function ping() {\n  return "pong";\n}\n';
    const url = `file:///${root.replace(/\\/g, '/').replace(/^\//, '')}/api.js`;
    const res = await post(
      batch([
        { type: 'scripts', scripts: [{ scriptId: '3', url, hash: 'abc', length: source.length }] },
        { type: 'source', scriptId: '3', hash: 'abc', url, source },
        {
          type: 'delta',
          phase: 'action',
          startedAt: 1,
          endedAt: 3,
          request: { method: 'GET', path: '/ping', status: 200 },
          coverage: [
            {
              scriptId: '3',
              url,
              functions: [
                {
                  functionName: 'ping',
                  isBlockCoverage: false,
                  ranges: [{ startOffset: 0, endOffset: source.length - 1, count: 1 }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(res.status).toBe(204);
    await gotTrace;
    ws.close();

    expect(messages[0]).toMatchObject({ type: 'welcome', protocolVersion: 1 });
    const trace = messages.find((m) => m.type === 'trace');
    expect(trace?.type === 'trace' && trace.trace.files).toEqual([
      {
        path: 'api.js',
        collector: 'node',
        firstSeenAt: 1,
        lines: [1, 2, 3].map((line) => ({ line, count: 1 })),
      },
    ]);
  });
});

describe('DaemonClient (protocol package) against the real daemon', () => {
  it('lists and fetches traces, and receives pushed traces', async () => {
    const { DaemonClient } = await import('@lightpath-dev/protocol');
    const client = await DaemonClient.connect(daemon.port, daemon.token);
    const pushed = new Promise<string>((resolve) => client.onTrace((t) => resolve(t.id)));

    daemon.store.put({
      id: 't_abc123def456',
      label: 'button: Checkout',
      origin: 'browser',
      startedAt: 1,
      files: [],
      requests: [],
      dropped: [],
    });

    expect(await pushed).toBe('t_abc123def456');
    expect(await client.listTraces({ label: 'checkout' })).toEqual([
      { id: 't_abc123def456', label: 'button: Checkout', startedAt: 1, fileCount: 0 },
    ]);
    expect((await client.getTrace('t_abc123def456'))?.label).toBe('button: Checkout');
    expect(await client.getTrace('t_000000000000')).toBeNull();
    client.close();
  });

  it('rejects a wrong token', async () => {
    const { DaemonClient } = await import('@lightpath-dev/protocol');
    await expect(DaemonClient.connect(daemon.port, 'wrong', 2000)).rejects.toThrow(/could not connect/);
  });
});
