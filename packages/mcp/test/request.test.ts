import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunningDaemon, startDaemon } from '@lightpath-dev/daemon';
import type { IngestBatch } from '@lightpath-dev/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isLoopbackAddress, newRequestTraceId, type Resolver, resolveTarget } from '../src/request.js';
import { createMcpServer, type McpOptions } from '../src/server.js';

// run_request (design section 4A, D-125). Every refusal happens before any network call.

const never: Resolver = async () => {
  throw new Error('the resolver must not be called');
};

describe('resolveTarget: loopback only', () => {
  it.each([
    ['http://example.com/api', 'the host is example.com'],
    ['http://10.0.0.1/api', 'the host is 10.0.0.1'],
    ['http://127.0.0.2/api', 'the host is 127.0.0.2'],
    ['http://0.0.0.0:3001/', 'the host is 0.0.0.0'],
    ['http://localhost.example.com/', 'the host is localhost.example.com'],
    ['ftp://localhost/x', 'the scheme is ftp'],
    ['file:///etc/passwd', 'the scheme is file'],
    ['http://user:pw@localhost:3001/', 'the URL has a user name or password'],
  ])('refuses %s', async (url, why) => {
    const t = await resolveTarget(url, undefined, never);
    expect(t).toMatchObject({ ok: false, code: 'not_loopback' });
    if (!t.ok) expect(t.message).toContain(why);
  });

  it('refuses localhost when it resolves anywhere but loopback', async () => {
    const t = await resolveTarget('http://localhost:3001/x', undefined, async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(t).toMatchObject({ ok: false, code: 'not_loopback' });
    if (!t.ok) expect(t.message).toContain('93.184.216.34');
  });

  it('accepts the three loopback hosts, and keeps the vetted address', async () => {
    expect(await resolveTarget('http://127.0.0.1:3001/a', undefined, never)).toMatchObject({
      ok: true,
      address: '127.0.0.1',
    });
    expect(await resolveTarget('http://[::1]:3001/a', undefined, never)).toMatchObject({
      ok: true,
      address: '::1',
    });
    const both: Resolver = async () => [
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ];
    expect(await resolveTarget('https://localhost/a', undefined, both)).toMatchObject({
      ok: true,
      address: '127.0.0.1',
      family: 4,
    });
  });

  it('resolves a path against the app URL, and asks for a full URL without one', async () => {
    const t = await resolveTarget('/api/orders?x=1', 'http://127.0.0.1:3001/', never);
    expect(t.ok && t.url.href).toBe('http://127.0.0.1:3001/api/orders?x=1');
    expect(await resolveTarget('/api/orders', undefined, never)).toMatchObject({
      ok: false,
      code: 'no_app_url',
    });
    // An app URL off loopback is refused like any other URL.
    expect(await resolveTarget('/api', 'http://example.com', never)).toMatchObject({
      ok: false,
      code: 'not_loopback',
    });
  });

  it('knows loopback addresses', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])
      expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ['10.0.0.1', '0.0.0.0', '::', '192.168.1.1', '::ffff:10.0.0.1'])
      expect(isLoopbackAddress(a)).toBe(false);
    expect(newRequestTraceId()).toMatch(/^t_[a-z0-9]{12}$/);
  });
});

// A stand-in app server: it records what it got, and, for /traced, reports a backend delta to the
// daemon with the request's trace id, as the Node agent does.
const SECRET_BODY = '{"card":"4242-secret-body"}';
const TOKEN = 'tok-secret-query';
let root: string;
let daemon: RunningDaemon;
let app: http.Server;
let appUrl = '';
const seen: {
  method: string | undefined;
  url: string | undefined;
  trace: string | undefined;
  body: string;
  proxied: boolean;
}[] = [];

const source = 'export function createOrder() {\n  return 1;\n}\n';
let fileUrl = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightpath-request-'));
  await writeFile(join(root, 'orders.js'), source);
  fileUrl = `file:///${root.replace(/\\/g, '/').replace(/^\//, '')}/orders.js`;
  daemon = await startDaemon({ workspaceRoots: [root] });
  app = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', async () => {
      const trace = req.headers['x-lightpath-trace'] as string | undefined;
      seen.push({ method: req.method, url: req.url, trace, body, proxied: /^https?:/.test(req.url ?? '') });
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      if (path === '/redirect-out') return res.writeHead(302, { location: 'http://example.com/steal' }).end();
      if (path === '/redirect-in') return res.writeHead(302, { location: '/api/next?token=x' }).end();
      if (path === '/plain') return res.writeHead(200).end('ok');
      if (trace) {
        const batch: IngestBatch = {
          protocolVersion: 1,
          agentId: 'node-test',
          messages: [
            { type: 'scripts', scripts: [{ scriptId: '1', url: fileUrl, hash: 'h', length: source.length }] },
            { type: 'source', scriptId: '1', hash: 'h', url: fileUrl, source },
            {
              type: 'delta',
              traceId: trace,
              phase: 'action',
              startedAt: Date.now() - 2,
              endedAt: Date.now(),
              request: { method: req.method ?? 'GET', path, status: 201 },
              coverage: [
                {
                  scriptId: '1',
                  url: fileUrl,
                  functions: [
                    {
                      functionName: 'createOrder',
                      isBlockCoverage: true,
                      ranges: [{ startOffset: 0, endOffset: source.length - 1, count: 1 }],
                    },
                  ],
                },
              ],
            },
          ],
        };
        await fetch(`${daemon.url}/v1/ingest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${daemon.token}` },
          body: JSON.stringify(batch),
        });
      }
      res
        .writeHead(201, { 'content-type': 'application/json', 'set-cookie': 'session=resp-secret' })
        .end('{"orderId":7,"secret":"resp-secret"}');
    });
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  app?.close();
  await daemon?.close();
  await rm(root, { recursive: true, force: true });
});

async function call(args: Record<string, unknown>, extra: Partial<McpOptions> = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ workspaceRoot: root, requestTraceWaitMs: 400, ...extra });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const res = await client.callTool({ name: 'run_request', arguments: args });
    return (res.content as { text: string }[])[0]?.text ?? '';
  } finally {
    await client.close();
  }
}

describe('run_request through the MCP server', () => {
  it('sends one request with the trace header and returns its backend trace, echoing no secret', async () => {
    seen.length = 0;
    const out = await call({ method: 'POST', url: `${appUrl}/api/orders?token=${TOKEN}`, body: SECRET_BODY });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', body: SECRET_BODY, proxied: false });
    expect(seen[0]?.trace).toMatch(/^t_[a-z0-9]{12}$/);
    expect(out.split('\n').slice(0, 3)).toEqual([
      `Trace ${seen[0]?.trace}: POST /api/orders`,
      expect.stringMatching(/^sent: POST \/api\/orders → 201 \(36 bytes, \d+ ms\)$/),
      expect.stringMatching(/^request: POST \/api\/orders → 201 \(node, \d+ ms\)$/),
    ]);
    expect(out).toContain('POST /api/orders → 201 [node,');
    expect(out).toContain('  orders.js');
    expect(out).toContain('    createOrder 1-3 ×1');
    for (const secret of ['4242-secret-body', TOKEN, 'resp-secret', 'session='])
      expect(out).not.toContain(secret);
    expect(out.length).toBeLessThanOrEqual(16_000);
  });

  it('resolves a path against url in lightpath.config.json', async () => {
    await writeFile(join(root, 'lightpath.config.json'), JSON.stringify({ url: appUrl }));
    try {
      seen.length = 0;
      const out = await call({ method: 'POST', url: '/api/orders' });
      expect(seen[0]?.url).toBe('/api/orders');
      expect(out).toContain('createOrder 1-3 ×1');
    } finally {
      await rm(join(root, 'lightpath.config.json'));
    }
  });

  it('refuses a non-loopback URL before any network call', async () => {
    seen.length = 0;
    const out = await call({ url: 'http://example.com/api/orders' }, { resolver: never });
    expect(out).toMatch(/^run_request did not send anything: not_loopback\./);
    expect(seen).toHaveLength(0);
  });

  it('refuses localhost that resolves off the machine, before any network call', async () => {
    seen.length = 0;
    const port = (app.address() as AddressInfo).port;
    const out = await call(
      { url: `http://localhost:${port}/api/orders` },
      { resolver: async () => [{ address: '10.0.0.5', family: 4 }] },
    );
    expect(out).toContain('not_loopback');
    expect(seen).toHaveLength(0);
  });

  it("doesn't follow a redirect, and names only a loopback target", async () => {
    seen.length = 0;
    const out = await call({ url: `${appUrl}/redirect-out` });
    expect(seen.map((s) => s.url)).toEqual(['/redirect-out']); // example.com was never asked
    expect(out).toContain('302');
    expect(out).not.toContain('example.com');
    const inner = await call({ url: `${appUrl}/redirect-in` });
    expect(inner).toContain(`it points to ${appUrl}/api/next`);
    expect(inner).not.toContain('token=x');
  });

  it('answers no_response for a closed port and no_trace for a server not under lightpath dev', async () => {
    const closed = http.createServer();
    closed.listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const port = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    expect(await call({ url: `http://127.0.0.1:${port}/api` })).toMatch(
      /^run_request got no response: no_response\. GET http:\/\/127\.0\.0\.1:\d+\/api failed/,
    );
    const plain = await call({ url: `${appUrl}/plain?token=${TOKEN}` });
    expect(plain).toMatch(/^run_request got GET \/plain → 200 \(2 bytes, \d+ ms\), but no trace: no_trace\./);
    expect(plain).not.toContain(TOKEN);
  });

  it('ignores HTTP_PROXY: the request still goes straight to the app', async () => {
    seen.length = 0;
    const before = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = 'http://127.0.0.1:9';
    try {
      const out = await call({ method: 'POST', url: `${appUrl}/api/orders` });
      expect(out).toContain('createOrder');
      expect(seen[0]?.proxied).toBe(false);
    } finally {
      if (before === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = before;
    }
  });

  it('says Lightpath is not running, and sends nothing, without a discovery file', async () => {
    seen.length = 0;
    const empty = await mkdtemp(join(tmpdir(), 'lightpath-none-'));
    try {
      const out = await call({ url: `${appUrl}/api/orders` }, { workspaceRoot: empty });
      expect(out).toMatch(/Lightpath isn't running in .* Nothing was sent\.$/);
      expect(seen).toHaveLength(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
