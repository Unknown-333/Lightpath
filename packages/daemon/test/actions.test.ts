import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ActionRequest,
  type ActionRunner,
  type IngestBatch,
  postAction,
  type Trace,
} from '@lightpath-dev/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missingBackend } from '../src/actions.js';
import { type RunningDaemon, startDaemon } from '../src/server.js';

let root: string;
let daemon: RunningDaemon;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightpath-action-'));
  daemon = await startDaemon({ workspaceRoots: [root] });
});

afterEach(async () => {
  await daemon.close();
  await rm(root, { recursive: true, force: true });
});

const request: ActionRequest = { protocolVersion: 1, target: 'button "Checkout"' };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${daemon.url}/v1/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${daemon.token}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const TRACE_ID = 't_abc123def456';
const browserTrace = (): Trace => ({
  id: TRACE_ID,
  label: 'button: Checkout',
  origin: 'browser',
  startedAt: 1,
  endedAt: 2,
  files: [],
  requests: [],
  dropped: [],
});

/** A runner that "clicks", stores a browser trace with one tagged request, and reports it. */
const fakeRunner =
  (seen: ActionRequest[] = []): ActionRunner =>
  async (req) => {
    seen.push(req);
    daemon.store.put(browserTrace());
    return {
      ok: true,
      traceId: TRACE_ID,
      boundary: 'press',
      settled: 'quiet',
      pageUrl: 'http://localhost:5173/',
      tagged: [{ method: 'POST', path: '/api/orders' }],
      warnings: [],
    };
  };

/** The Node agent's backend delta for the tagged request, through /v1/ingest like the real one. */
const backendDelta = (): IngestBatch => ({
  protocolVersion: 1,
  agentId: 'node-1',
  messages: [
    {
      type: 'delta',
      traceId: TRACE_ID,
      phase: 'action',
      startedAt: 1,
      endedAt: 2,
      request: { method: 'POST', path: '/api/orders', status: 201 },
      coverage: [],
    },
  ],
});

describe('POST /v1/action transport (D-115)', () => {
  it('refuses a missing or wrong token with 401 and any Origin with 403', async () => {
    daemon.setActionRunner(fakeRunner());
    expect((await post(request, { authorization: 'Bearer wrong' })).status).toBe(401);
    const noAuth = await fetch(`${daemon.url}/v1/action`, { method: 'POST', body: JSON.stringify(request) });
    expect(noAuth.status).toBe(401);
    expect((await post(request, { origin: 'http://evil.example' })).status).toBe(403);
  });

  it('refuses a body over 256 KB with 413', async () => {
    const big = { ...request, fill: [{ target: 'textbox "Notes"', value: 'x'.repeat(300 * 1024) }] };
    const res = await post(big);
    expect(res.status).toBe(413);
  });

  it('refuses schema errors with 400, naming fields and never values', async () => {
    const tooLong = {
      ...request,
      fill: [{ target: 'textbox "Notes"', value: `secret-${'y'.repeat(10_001)}` }],
    };
    const res = await post(tooLong);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('secret-');
    expect((await post({ ...request, key: 'Enter' })).status).toBe(400); // key without press
    expect((await post({ ...request, target: '' })).status).toBe(400);
    expect((await post({ ...request, timeoutMs: 100 })).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
  });

  it('refuses another protocol version with 426', async () => {
    expect((await post({ ...request, protocolVersion: 2 })).status).toBe(426);
  });

  it('answers no_browser when no runner is registered', async () => {
    const result = await postAction(daemon.port, daemon.token, request);
    expect(result).toMatchObject({ ok: false, error: { code: 'no_browser' } });
    daemon.setActionRunner(fakeRunner());
    daemon.setActionRunner(undefined);
    expect(await postAction(daemon.port, daemon.token, request)).toMatchObject({
      ok: false,
      error: { code: 'no_browser' },
    });
  });
});

describe('the backend wait (design section 4.3)', () => {
  it('ends as soon as the backend delta for the tagged request arrives', async () => {
    const seen: ActionRequest[] = [];
    daemon.setActionRunner(fakeRunner(seen));
    const started = performance.now();
    setTimeout(() => {
      void fetch(`${daemon.url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${daemon.token}` },
        body: JSON.stringify(backendDelta()),
      });
    }, 200);
    const result = await postAction(daemon.port, daemon.token, { ...request, within: 'Cart' });
    const elapsed = performance.now() - started;
    expect(seen).toEqual([{ ...request, within: 'Cart' }]);
    expect(result).toMatchObject({ ok: true, backend: 'complete', boundary: 'press', warnings: [] });
    if (result.ok) expect(result.trace.requests).toMatchObject([{ method: 'POST', path: '/api/orders' }]);
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(1200);
  });

  it('gives up after 1.5 s and marks the backend partial', async () => {
    daemon.setActionRunner(fakeRunner());
    const started = performance.now();
    const result = await postAction(daemon.port, daemon.token, request);
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({ ok: true, backend: 'partial' });
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toEqual(['backend_partial']);
      expect(result.warnings[0]?.message).toContain('POST /api/orders');
    }
    expect(elapsed).toBeGreaterThanOrEqual(1450);
    expect(elapsed).toBeLessThan(3000);
  });

  it('passes a runner failure straight through, with no wait', async () => {
    daemon.setActionRunner(async () => ({
      ok: false,
      error: { code: 'ambiguous', message: '2 elements match', count: 2, candidates: ['a', 'b'] },
    }));
    expect(await postAction(daemon.port, daemon.token, request)).toEqual({
      ok: false,
      error: { code: 'ambiguous', message: '2 elements match', count: 2, candidates: ['a', 'b'] },
    });
  });
});

describe('missingBackend', () => {
  const trace = (requests: Trace['requests']): Trace => ({ ...browserTrace(), requests });
  const req = (method: string, path: string, collector: 'node' | 'browser' = 'node') => ({
    collector,
    pid: 1,
    method,
    path,
    durationMs: 1,
    overlapped: false,
  });

  it('matches by method and path, ignores the query, and counts repeats', () => {
    const tagged = [
      { method: 'GET', path: '/api/items' },
      { method: 'GET', path: '/api/items' },
      { method: 'POST', path: '/api/orders' },
    ];
    expect(missingBackend(trace([req('GET', '/api/items?page=2')]), tagged)).toEqual([
      { method: 'GET', path: '/api/items' },
      { method: 'POST', path: '/api/orders' },
    ]);
    expect(
      missingBackend(
        trace([req('GET', '/api/items'), req('GET', '/api/items'), req('post', '/api/orders')]),
        tagged,
      ),
    ).toEqual([]);
    expect(missingBackend(trace([req('POST', '/api/orders', 'browser')]), [tagged[2] as never])).toHaveLength(
      1,
    );
    expect(missingBackend(undefined, [])).toEqual([]);
  });
});
