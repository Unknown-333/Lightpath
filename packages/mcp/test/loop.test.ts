import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunningDaemon, startDaemon } from '@lightpath-dev/daemon';
import type { ActionRequest, FunctionHit, Trace } from '@lightpath-dev/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/server.js';

// The MCP tools against a real daemon whose action runner is a fake browser: each action stores
// the next trace from `queue` (or a default one) and reports it, as the collector would.

let root: string;
let daemon: RunningDaemon;
let client: Client;
const received: ActionRequest[] = [];
let queue: ((id: string) => Trace)[] = [];
let n = 0;

const fn = (over: Partial<FunctionHit> & Pick<FunctionHit, 'path' | 'name' | 'startLine' | 'endLine'>) =>
  ({ collector: 'browser', count: 1, phase: 0, ...over }) as FunctionHit;

/** A one-phase trace of `label` with the given functions. */
export function traceOf(id: string, label: string, functions: FunctionHit[], startedAt = Date.now()): Trace {
  const paths = [...new Set(functions.map((f) => f.path))];
  return {
    id,
    label,
    origin: 'browser',
    startedAt,
    endedAt: startedAt + 10,
    files: paths.map((path, i) => ({
      path,
      collector: 'browser',
      lines: functions
        .filter((f) => f.path === path)
        .flatMap((f) => [{ line: f.startLine, count: f.count || 1 }]),
      firstSeenAt: i,
    })),
    requests: [],
    dropped: [],
    phases: [{ kind: 'browser' }],
    functions,
  };
}

const addToCart = (id: string) =>
  traceOf(id, 'button: Add to cart', [
    fn({ path: 'src/App.tsx', name: 'addToCart', startLine: 15, endLine: 24, notRun: [18, 19] }),
  ]);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lightpath-loop-'));
  daemon = await startDaemon({ workspaceRoots: [root] });
  daemon.setActionRunner(async (request) => {
    received.push(request);
    n += 1;
    const id = `t_${String(n).padStart(12, '0')}`;
    const make = queue.shift() ?? addToCart;
    daemon.store.put(make(id));
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

beforeEach(() => {
  received.length = 0;
  queue = [];
});

/** One tool call's text and error flag. */
async function call(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: res.content.map((c) => c.text).join('\n'), isError: res.isError ?? false };
}

describe('run_action input (D-140)', () => {
  it('takes press: "Space" as a key press, and a plain call as a click', async () => {
    const pressed = await call('run_action', { target: 'button "Add to cart"', press: 'Space' });
    expect(pressed.isError).toBe(false);
    expect(pressed.text).toContain('action: press Space on button "Add to cart"');
    await call('run_action', { target: 'button "Add to cart"' });
    expect(received.map((r) => [r.action, r.key])).toEqual([
      ['press', 'Space'],
      [undefined, undefined],
    ]);
  });
});
