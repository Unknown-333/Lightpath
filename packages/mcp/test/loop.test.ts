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
/** The 1-based call (within one test) that answers not_found, if any. */
let failAt = 0;

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
    if (failAt === received.length) {
      return { ok: false, error: { code: 'not_found', message: 'No element matches button "Add to cart".' } };
    }
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
  failAt = 0;
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

/** b04's two presses: the first adds a line (lines 18-19 run), the second finds it (16-17 run). */
const firstAdd = (id: string) =>
  traceOf(id, 'button: Add to cart', [
    fn({ path: 'src/App.tsx', name: 'addToCart', startLine: 15, endLine: 24, notRun: [16, 17] }),
  ]);
const secondAdd = (id: string) =>
  traceOf(id, 'button: Add to cart', [
    fn({ path: 'src/App.tsx', name: 'addToCart', startLine: 15, endLine: 24, notRun: [18, 19] }),
  ]);

describe('run_action times (D-142)', () => {
  it('does the action that many times and returns one trace with the counts added up', async () => {
    queue = [firstAdd, secondAdd];
    const { text, isError } = await call('run_action', {
      target: 'button "Add to cart"',
      within: 'Desk lamp',
      times: 2,
    });
    expect(isError).toBe(false);
    expect(received).toHaveLength(2);
    const lines = text.split('\n');
    const [, , , rep] = lines;
    expect(lines[1]).toBe(
      'action: click button "Add to cart" within "Desk lamp" (boundary press, settled quiet)',
    );
    expect(rep).toMatch(
      /^repeated: 2 of 2 runs \((t_\d{12}), (t_\d{12})\); line and call counts below are added up over them\. get_trace on \2 shows the last run alone\.$/,
    );
    // The last run's id heads the trace; each branch ran in one of the runs, so none is "not run".
    const lastId = /, (t_\d{12})\)/.exec(rep ?? '')?.[1];
    expect(lines[0]).toBe(`Trace ${lastId}: button: Add to cart`);
    expect(text).toMatch(/^ {4}addToCart 15-24 ×2$/m);
    expect(text).not.toContain('not run');
  });

  it('stops at the first run that misses and says which', async () => {
    failAt = 3;
    const { text, isError } = await call('run_action', { target: 'button "Add to cart"', times: 4 });
    expect(isError).toBe(false);
    expect(received).toHaveLength(3);
    expect(text).toContain('repeated: 2 of 4 runs');
    expect(text).toContain(
      'warning (repeat_stopped): run 3 of 4 did not record a trace: not_found. No element matches button "Add to cart".',
    );
  });

  it('refuses more than 5 runs', async () => {
    const { isError } = await call('run_action', { target: 'button "Add to cart"', times: 6 });
    expect(isError).toBe(true);
    expect(received).toHaveLength(0);
  });
});

describe('find_code_for_action with nothing recorded (D-143)', () => {
  it('answers with the run_action call that records it', async () => {
    const { text } = await call('find_code_for_action', { action: 'Set in progress' });
    expect(text).toBe(
      [
        'No recorded action matches "Set in progress" yet, so there is no trace to read. Record it now with:',
        '  run_action {"target":"Set in progress"}',
        'If it needs sign-in or setup steps first, do each with its own run_action call. Or ask the user to click it in the app opened by `lightpath dev`.',
      ].join('\n'),
    );
    // The call is valid run_action input, and it records the action.
    const args = JSON.parse(text.split('\n')[1]?.replace('  run_action ', '') ?? '{}');
    const recorded = await call('run_action', args);
    expect(recorded.isError).toBe(false);
    expect(received.at(-1)?.target).toBe('Set in progress');
  });
});

/** b04 after the fix: the second press now re-renders the cart. */
const fixedSecondAdd = (id: string) =>
  traceOf(id, 'button: Add to cart', [
    fn({ path: 'src/App.tsx', name: 'addToCart', startLine: 15, endLine: 23, notRun: [17] }),
    fn({ path: 'src/Cart.tsx', name: 'Cart', startLine: 11, endLine: 50 }),
  ]);

describe('run_action compareTo (D-144)', () => {
  it('"last" adds the function diff against the newest earlier trace of the same action', async () => {
    queue = [firstAdd, secondAdd];
    const before = await call('run_action', { target: 'button "Add to cart"', times: 2 });
    const beforeId = /, (t_\d{12})\)/.exec(before.text)?.[1];
    queue = [firstAdd, fixedSecondAdd];
    const { text, isError } = await call('run_action', {
      target: 'button "Add to cart"',
      times: 2,
      compareTo: 'last',
    });
    expect(isError).toBe(false);
    // The new trace, then a blank line and the diff.
    const at = text.lastIndexOf('\n\nTrace ');
    const traceText = text.slice(0, at);
    const diff = text.slice(at + 2);
    expect(traceText).toContain(`compareTo: ${beforeId}; what changed against it is at the end.`);
    expect(traceText).toContain('repeated: 2 of 2 runs');
    const lastId = /^Trace (t_\d{12})/.exec(text)?.[1];
    expect(diff?.trim()).toBe(
      [
        `Trace ${beforeId} (button: Add to cart) → ${lastId} (button: Add to cart):`,
        `ran only in ${lastId}:`,
        '  src/Cart.tsx Cart (line 11) ×1',
        'branches changed (each side in its own line numbers):',
        '  src/App.tsx addToCart: now runs 18-19; no longer runs 17',
      ].join('\n'),
    );
  });

  it('keeps the trace and the diff together under 16,000 characters', async () => {
    const big = (shift: number) => (id: string) =>
      traceOf(
        id,
        'button: Big',
        Array.from({ length: 1500 }, (_, i) =>
          fn({
            path: `src/f${i}.tsx`,
            name: `F${i}`,
            startLine: 1 + shift,
            endLine: 40,
            notRun: [5 + shift],
          }),
        ),
      );
    queue = [big(0)];
    await call('run_action', { target: 'button "Big"' });
    queue = [big(1)];
    const { text } = await call('run_action', { target: 'button "Big"', compareTo: 'last' });
    expect(text.length).toBeLessThanOrEqual(16_000);
    expect(text).toMatch(/^compareTo: t_\d{12}; what changed against it is at the end\.$/m);
    expect(text).toMatch(/\n\nTrace t_\d{12} \(button: Big\) → t_\d{12} \(button: Big\):\n/);
  });

  it('takes a trace id, says when there is nothing to compare, and refuses anything else', async () => {
    queue = [(i) => traceOf(i, 'button: Only once', []), (i) => traceOf(i, 'button: Only once', [])];
    const first = await call('run_action', { target: 'button "Only once"' });
    const id = /^Trace (t_\d{12})/.exec(first.text)?.[1];
    const none = await call('run_action', { target: 'button "Only once"', compareTo: 'last' });
    expect(none.text).toContain('none: both traces ran the same functions and branches');
    queue = [(i) => traceOf(i, 'button: Brand new', [])];
    const fresh = await call('run_action', { target: 'button "Brand new"', compareTo: 'last' });
    expect(fresh.text).toContain(
      'compareTo: no earlier trace of "button: Brand new" to compare with; this is the first.',
    );
    const byId = await call('run_action', { target: 'button "Add to cart"', compareTo: id });
    expect(byId.text).toContain(`compareTo: ${id}; what changed against it is at the end.`);
    const before = received.length;
    const bad = await call('run_action', { target: 'button "Add to cart"', compareTo: 'yesterday' });
    expect(bad).toEqual({
      text: 'run_action did nothing: compareTo must be a trace id like "t_abc123def456", or "last".',
      isError: true,
    });
    expect(received).toHaveLength(before);
  });
});
