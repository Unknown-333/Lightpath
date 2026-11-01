import type { ActionResult, Trace } from '@lightpath-dev/protocol';
import { describe, expect, it } from 'vitest';
import { describeAction, describeActionResult } from '../src/format.js';
import { redactFillValues } from '../src/redact.js';
import { RUN_ACTION_DESCRIPTION } from '../src/server.js';

const trace: Trace = {
  id: 't_abc123def456',
  label: 'button: Checkout',
  origin: 'browser',
  startedAt: 0,
  files: [
    { path: 'src/Cart.tsx', collector: 'browser', lines: [{ line: 21, count: 1 }], firstSeenAt: 0 },
    { path: 'server/routes/orders.ts', collector: 'node', lines: [{ line: 12, count: 1 }], firstSeenAt: 1 },
  ],
  requests: [
    {
      collector: 'node',
      pid: 1,
      method: 'POST',
      path: '/api/orders',
      status: 201,
      durationMs: 3,
      overlapped: false,
    },
  ],
  dropped: [],
};

const ok = (extra: Partial<Extract<ActionResult, { ok: true }>> = {}): ActionResult => ({
  ok: true,
  trace,
  boundary: 'press',
  settled: 'quiet',
  backend: 'complete',
  pageUrl: 'http://localhost:5173/',
  warnings: [],
  ...extra,
});

describe('run_action description (design section 3)', () => {
  it('is the design text, under 300 characters', () => {
    expect(RUN_ACTION_DESCRIPTION.length).toBe(295);
    expect(RUN_ACTION_DESCRIPTION.startsWith('Click a button or link, or press Enter or Space')).toBe(true);
  });
});

describe('describeActionResult (design section 4.5)', () => {
  it('puts the action and page lines after the trace line, then the summary (build 2)', () => {
    // This trace has no phases (a daemon before build 2), so its files print by line range.
    expect(describeActionResult({ target: 'button "Checkout"' }, ok())).toBe(
      [
        'Trace t_abc123def456: button: Checkout',
        'action: click button "Checkout" (boundary press, settled quiet)',
        'page: http://localhost:5173/',
        'request: POST /api/orders → 201 (node, 3 ms)',
        '',
        'files',
        '  src/Cart.tsx [browser] lines 21',
        '  server/routes/orders.ts [node] lines 12',
      ].join('\n'),
    );
  });

  it('names a key press, within and fills, and lists warnings on their own lines', () => {
    const text = describeActionResult(
      {
        target: 'button "Add to cart"',
        within: 'Coffee mug',
        action: 'press',
        key: 'Space',
        fill: [{ target: 'textbox "Coupon"', value: 'WELCOME10' }],
      },
      ok({
        boundary: 'key',
        settled: 'timeout',
        backend: 'partial',
        warnings: [
          { code: 'timeout', message: 'timed out after 500 ms' },
          { code: 'backend_partial', message: 'No backend lines for POST /api/x' },
        ],
      }),
    );
    expect(text.split('\n').slice(1, 5)).toEqual([
      'action: press Space on button "Add to cart" within "Coffee mug", after filling 1 field (boundary key, settled timeout)',
      'page: http://localhost:5173/',
      'warning (timeout): timed out after 500 ms',
      'warning (backend_partial): No backend lines for POST /api/x',
    ]);
  });

  it('shows the outcome and candidates when nothing was recorded', () => {
    const text = describeActionResult(
      { target: 'button "Add to cart"' },
      {
        ok: false,
        error: {
          code: 'ambiguous',
          message: '2 elements match button "Add to cart"; nothing was clicked.',
          count: 2,
          candidates: ['button "Add to cart" in "Desk lamp"', 'button "Add to cart" in "Coffee mug"'],
        },
      },
    );
    expect(text).toBe(
      [
        'run_action did not record a trace: ambiguous. 2 elements match button "Add to cart"; nothing was clicked.',
        'Matches:',
        '  button "Add to cart" in "Desk lamp"',
        '  button "Add to cart" in "Coffee mug"',
      ].join('\n'),
    );
    expect(describeAction({ target: 'Checkout' })).toBe('click Checkout');
  });

  it('never prints a fill value, wherever the app echoed it (rule 6)', () => {
    const secret = 'hunter 22';
    const echoed: Trace = { ...trace, label: `button: Apply ${secret}` };
    const input = { target: 'css=#apply', fill: [{ target: 'textbox "Password"', value: secret }] };
    const text = describeActionResult(
      input,
      ok({
        trace: echoed,
        pageUrl: `http://localhost:5173/?code=${encodeURIComponent(secret)}`,
        warnings: [{ code: 'click_lost', message: `got no click for ${secret}` }],
      }),
    );
    expect(text).not.toContain(secret);
    expect(text).not.toContain(encodeURIComponent(secret));
    expect(text.match(/\[redacted\]/g)).toHaveLength(3);
    const failed = describeActionResult(input, {
      ok: false,
      error: { code: 'not_found', message: 'none', candidates: [`button "Apply ${secret}"`] },
    });
    expect(failed).not.toContain(secret);
  });
});

describe('redactFillValues', () => {
  it('replaces every value of 4 or more characters, longest first, and leaves short ones', () => {
    expect(redactFillValues('a hunter2 b hunter2 c', ['hunter2'])).toBe('a [redacted] b [redacted] c');
    expect(redactFillValues('pin 123 and abcd', ['123', 'abcd'])).toBe('pin 123 and [redacted]');
    expect(redactFillValues('password1', ['pass', 'password1'])).toBe('[redacted]');
  });
});
