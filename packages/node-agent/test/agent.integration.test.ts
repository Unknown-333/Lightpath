import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IngestBatch, IngestMessage } from '@lightpath-dev/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const registerPath = fileURLToPath(new URL('../dist/register.js', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const handlerUrl = pathToFileURL(`${fixtures}handler.mjs`).href;
const TOKEN = 't'.repeat(43);

let daemon: http.Server;
let daemonUrl = '';
const received: IngestMessage[] = [];
const authHeaders: (string | undefined)[] = [];

beforeAll(async () => {
  daemon = http.createServer((req, res) => {
    authHeaders.push(req.headers.authorization);
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push(...(JSON.parse(body) as IngestBatch).messages);
      res.writeHead(204).end();
    });
  });
  daemon.listen(0, '127.0.0.1');
  await once(daemon, 'listening');
  daemonUrl = `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`;
});

afterAll(() => {
  daemon.close();
});

describe.skipIf(!existsSync(registerPath))('node agent loaded with --import', () => {
  it('reports a request delta with the trace id, the handler coverage, and its source', async () => {
    const child = spawn(
      process.execPath,
      [`--import=${pathToFileURL(registerPath).href}`, `${fixtures}server.mjs`],
      {
        env: {
          ...process.env,
          LIGHTPATH_URL: daemonUrl,
          LIGHTPATH_TOKEN: TOKEN,
          LIGHTPATH_ROOTS: fixtures,
          LIGHTPATH_DEBUG: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    const [line] = (await once(child.stdout, 'data')) as [Buffer];
    const port = /ready (\d+)/.exec(line.toString())?.[1];
    expect(port, stderr).toBeDefined();

    const res = await fetch(`http://127.0.0.1:${port}/api/orders?x=1`, {
      method: 'POST',
      headers: { 'x-lightpath-trace': 't_abc123def456' },
    });
    expect(res.status).toBe(201);

    // The server closes after one request. The child must then exit by itself: if the agent
    // held the event loop open, this would time out.
    const [code] = (await once(child, 'exit')) as [number];
    expect(code, stderr).toBe(0);

    expect(authHeaders.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
    expect(received.find((m) => m.type === 'hello')).toMatchObject({ kind: 'node', protocolVersion: 1 });

    const delta = received.find((m) => m.type === 'delta' && m.phase === 'action');
    expect(delta).toMatchObject({
      traceId: 't_abc123def456',
      request: { method: 'POST', path: '/api/orders', status: 201 },
    });
    if (delta?.type !== 'delta') throw new Error('no action delta');

    const script = delta.coverage.find((s) => s.url === handlerUrl);
    const fn = script?.functions.find((f) => f.functionName === 'handleOrder');
    expect(fn?.ranges[0]?.count, JSON.stringify(delta.coverage.map((s) => s.url))).toBe(1);
    // The empty-cart branch didn't run, so it appears as an inner range with count 0.
    expect(fn?.ranges.some((r) => r.count === 0)).toBe(true);
    // Agent internals and node: builtins never leave the process.
    expect(delta.coverage.some((s) => s.url.startsWith('node:') || s.url.includes('/node-agent/dist/'))).toBe(
      false,
    );

    const source = received.find((m) => m.type === 'source' && m.url === handlerUrl);
    expect(source?.type === 'source' && source.source).toContain('export function handleOrder');
  }, 20_000);
});
