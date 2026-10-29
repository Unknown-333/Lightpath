import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countsTowardSettle, isNoiseScript, labelFor, shouldTag } from '../src/rules.js';
import { SettleTracker } from '../src/settle.js';

describe('SettleTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('settles after the quiet window when nothing is in flight', async () => {
    const t = new SettleTracker({ settleMs: 300, maxSettleMs: 5000 });
    const done = t.begin();
    await vi.advanceTimersByTimeAsync(299);
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toBe('quiet');
  });

  it('waits for in-flight requests, then restarts the quiet window', async () => {
    const t = new SettleTracker({ settleMs: 300, maxSettleMs: 5000 });
    const done = t.begin();
    t.requestStarted();
    await vi.advanceTimersByTimeAsync(1000);
    t.requestEnded();
    await vi.advanceTimersByTimeAsync(300);
    expect(await done).toBe('quiet');
  });

  it('gives up at the hard cap when a request never finishes', async () => {
    const t = new SettleTracker({ settleMs: 300, maxSettleMs: 2000 });
    t.requestStarted();
    const done = t.begin();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBe('timeout');
  });

  it('cancel ends the window immediately', async () => {
    const t = new SettleTracker({ settleMs: 300, maxSettleMs: 5000 });
    const done = t.begin();
    t.cancel();
    expect(await done).toBe('quiet');
  });
});

describe('shouldTag', () => {
  const origins = ['http://localhost:5173', 'http://localhost:3000'];
  it.each([
    ['http://localhost:5173/api/orders', 'fetch', true],
    ['http://localhost:3000/api/orders', 'xhr', true],
    ['http://localhost:5173/src/Cart.tsx', 'script', false],
    ['https://api.stripe.com/v1/charges', 'fetch', false],
    ['http://localhost:3000/orders/7', 'navigation', true],
    ['https://example.com/', 'navigation', false],
    ['http://localhost:3000/page', 'document', false],
    ['not a url', 'fetch', false],
    // Loopback APIs on another port are tagged without being listed (D-086).
    ['http://localhost:3001/quizzes/1', 'fetch', true],
    ['http://127.0.0.1:8080/api', 'xhr', true],
    ['http://[::1]:4000/api', 'fetch', true],
    ['http://localhost:3001/logo.png', 'image', false],
    ['http://localhost.example.com/api', 'fetch', false],
    ['http://192.168.1.5:3001/api', 'fetch', false],
  ])('%s (%s) → %s', (url, type, expected) => {
    expect(shouldTag(url, type, origins)).toBe(expected);
  });
});

describe('labelFor', () => {
  it.each([
    [{ tag: 'button', text: 'Checkout' }, 'button: Checkout'],
    [{ tag: 'div', role: 'tab', name: 'Settings' }, 'tab: Settings'],
    [{ tag: 'a', testId: 'nav-home' }, 'a: nav-home'],
    [{ tag: 'span' }, 'span'],
    [{}, 'element'],
    [{ tag: 'p', text: `  ${'x'.repeat(60)}  ` }, `p: ${'x'.repeat(39)}…`],
    [{ tag: 'button', text: 'Checkout', key: 'Enter' }, 'button: Checkout (Enter)'],
    [{ tag: 'input', name: 'Coupon', key: 'Enter' }, 'input: Coupon (Enter)'],
  ])('%j → %s', (target, label) => {
    expect(labelFor(target)).toBe(label);
  });
});

describe('isNoiseScript and countsTowardSettle', () => {
  it.each([
    ['http://localhost:5173/src/Cart.tsx', false],
    ['http://localhost:5173/node_modules/.vite/deps/react.js', true],
    ['http://localhost:5173/@vite/client', true],
    ['http://localhost:5173/@react-refresh', true],
    ['chrome-extension://abc/content.js', true],
    ['', true],
  ])('%s noise=%s', (url, noise) => {
    expect(isNoiseScript(url)).toBe(noise);
  });

  it('ignores long-lived connections for settling', () => {
    expect(countsTowardSettle('fetch')).toBe(true);
    expect(countsTowardSettle('websocket')).toBe(false);
    expect(countsTowardSettle('eventsource')).toBe(false);
  });
});
