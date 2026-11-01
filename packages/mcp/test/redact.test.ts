import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunningDaemon, startDaemon } from '@lightpath-dev/daemon';
import type { Trace } from '@lightpath-dev/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redact } from '../src/redact.js';
import { createMcpServer } from '../src/server.js';
import { summarizeTrace } from '../src/summary.js';

// Redaction rules 2 to 5 (D-123, design section 9), one test each, then every tool at once.
describe('redact', () => {
  it('rule 2: query values whose name holds a secret word', () => {
    expect(redact('/cb?code=1&session_id=abc')).toBe('/cb?code=1&session_id=[redacted]');
    expect(redact('http://localhost/x?API_KEY=k1&page=2')).toBe(
      'http://localhost/x?API_KEY=[redacted]&page=2',
    );
    expect(redact('/x?sig=abc#top')).toBe('/x?sig=[redacted]#top');
  });

  it('rule 3: bearer tokens', () => {
    expect(redact('Bearer eyAbc.def')).toBe('Bearer [redacted]');
    expect(redact('got bearer abc123 back')).toBe('got bearer [redacted] back');
  });

  it('rule 4: JWT-like strings', () => {
    expect(redact('token eyJhbGciOi.eyJzdWIiOi.SflKxw expired')).toBe('token [redacted] expired');
  });

  it('rule 5: key=value and key: value pairs whose key holds a secret word', () => {
    expect(redact('password=hunter2')).toBe('password=[redacted]');
    expect(redact('"apiKey": "x1"')).toBe('"apiKey": "[redacted]"');
    expect(redact('Error: bad secret: s3cr3t at login')).toBe('Error: bad secret: [redacted] at login');
    expect(redact('Authorization: Bearer abc.def')).toBe('Authorization: [redacted] [redacted]');
    // Over-redaction on purpose: a missed secret is worse than a hidden harmless value.
    expect(redact('monkey=1')).toBe('monkey=[redacted]');
  });

  it('leaves the summary format alone', () => {
    for (const s of [
      'not run: 15-17',
      'request: POST /api/orders → 201 (node, 3 ms)',
      "TypeError: Cannot read properties of undefined (reading 'qty')",
    ])
      expect(redact(s)).toBe(s);
  });
});

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
const SECRETS = ['qtok-111', 'bearer-222', JWT, 'pw-333', 'hdr-444'];
const trace: Trace = {
  id: 't_abc123def456',
  label: 'button: Log in password=pw-333',
  origin: 'browser',
  startedAt: 1,
  endedAt: 2,
  files: [{ path: 'src/login.ts', collector: 'browser', lines: [{ line: 3, count: 1 }], firstSeenAt: 1 }],
  requests: [
    {
      collector: 'node',
      pid: 1,
      method: 'POST',
      path: '/api/login?token=qtok-111',
      status: 500,
      durationMs: 4,
      overlapped: false,
    },
  ],
  dropped: [],
  phases: [{ kind: 'backend', request: 0 }],
  functions: [
    {
      path: 'src/login.ts',
      collector: 'browser',
      name: 'login',
      startLine: 3,
      endLine: 3,
      count: 1,
      phase: 0,
    },
  ],
  problems: [
    {
      collector: 'browser',
      kind: 'exception',
      at: 1,
      message: `Error: rejected Authorization: Bearer bearer-222 with ${JWT}`,
    },
    {
      collector: 'browser',
      kind: 'console-error',
      at: 2,
      message: 'request headers {"x-api-key": "hdr-444"}',
    },
    {
      collector: 'browser',
      kind: 'request-failed',
      at: 3,
      message: 'POST /api/login → 500',
      request: { method: 'POST', path: '/api/login?session=qtok-111', status: 500 },
    },
  ],
};

let root: string;
let daemon: RunningDaemon;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightpath-redact-'));
  daemon = await startDaemon({ workspaceRoots: [root] });
  daemon.store.put(trace);
  daemon.store.put({ ...trace, id: 't_abc123def457' });
});
afterAll(async () => {
  await daemon.close();
  await rm(root, { recursive: true, force: true });
});

describe('every tool redacts what it returns', () => {
  it('shows the problem lines, and no seeded secret in any tool', async () => {
    expect(summarizeTrace(trace)).toContain(
      'errors: 2 (first: Error: rejected Authorization: Bearer bearer-222',
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ workspaceRoot: root });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const calls: [string, Record<string, unknown>][] = [
      ['find_code_for_action', { action: 'Log in' }],
      ['get_trace', { traceId: trace.id }],
      ['list_traces', {}],
      ['diff_traces', { a: trace.id, b: 't_abc123def457' }],
      ['run_action', { target: 'button "Log in"' }],
      ['run_request', { url: 'http://example.com/?token=qtok-111' }],
    ];
    try {
      for (const [name, args] of calls) {
        const res = await client.callTool({ name, arguments: args });
        const out = (res.content as { text: string }[])[0]?.text ?? '';
        for (const s of SECRETS) expect(out, `${name} leaks ${s}`).not.toContain(s);
        if (name === 'get_trace') {
          expect(out).toContain(
            'errors: 2 (first: Error: rejected Authorization: [redacted] [redacted] with [redacted])',
          );
          // Two paths (their queries differ), each shown with the query value hidden.
          expect(out).toContain('failed requests: 2 (first: POST /api/login?session=[redacted] → 500)');
        }
      }
    } finally {
      await client.close();
    }
  });
});
