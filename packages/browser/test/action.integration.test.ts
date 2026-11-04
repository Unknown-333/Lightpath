import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startDaemon } from '@lightpath-dev/daemon';
import { describeActionResult } from '@lightpath-dev/mcp';
import {
  type ActionRequest,
  type IngestMessage,
  PROTOCOL_VERSION,
  postAction,
} from '@lightpath-dev/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserCollector } from '../src/collector.js';

// run_action on a real browser (design section 14, build 1). Only when asked:
// LIGHTPATH_BROWSER_TESTS=1 pnpm --filter @lightpath-dev/browser test
const enabled = process.env.LIGHTPATH_BROWSER_TESTS === '1';

const SECRET = 'hunter2-secret';

const appJs = `
export function checkout() {
  return fetch('/api/orders', { method: 'POST' }).then((r) => r.text()).then((t) => {
    document.getElementById('out').textContent = t;
  });
}
document.getElementById('buy').addEventListener('click', checkout);
// Press-time code: in the click's trace only while the boundary is at the press (D-082).
export function pressed() {
  window.pressedAt = Date.now();
}
document.getElementById('buy').addEventListener('pointerdown', pressed);
export function guest() {
  document.getElementById('out').textContent = 'guest';
}
document.getElementById('guest').addEventListener('click', guest);
export function addToCart(event) {
  document.getElementById('cart').textContent += event.currentTarget.closest('li').dataset.name + ';';
}
for (const b of document.querySelectorAll('.add')) b.addEventListener('click', addToCart);
// Echoes the coupon everywhere a careless app might: the button label, a console error, the URL.
export function echo() {
  document.getElementById('apply').textContent = 'Apply ' + document.getElementById('code').value;
}
document.getElementById('code').addEventListener('input', echo);
export function apply() {
  const v = document.getElementById('code').value;
  console.error('bad coupon ' + v);
  history.replaceState(null, '', '?code=' + encodeURIComponent(v));
  document.getElementById('out').textContent = 'applied';
}
document.getElementById('apply').addEventListener('click', apply);
export function slow() {
  return fetch('/api/slow').then((r) => r.text());
}
document.getElementById('slow').addEventListener('click', slow);
// Hides itself on press, so the release lands elsewhere and the click goes to an ancestor.
export function jump(event) {
  event.currentTarget.style.display = 'none';
}
document.getElementById('jumpy').addEventListener('pointerdown', jump);
export function three() {
  const post = () => fetch('/api/orders', { method: 'POST' });
  return Promise.all([post(), post(), post()]);
}
document.getElementById('three').addEventListener('click', three);
// D-121: a thrown error, a console.error, a 404 and a fetch to a closed port in one click.
export function broken() {
  console.error('broken: console says no');
  fetch('/api/missing');
  fetch(window.CLOSED + '/nothing').catch(() => {});
  setTimeout(() => {
    throw new TypeError('broken: thrown from a timer');
  }, 0);
}
document.getElementById('broken').addEventListener('click', broken);
`;
const pageTwoJs = `export function arrived() {
  document.getElementById('here').textContent = 'arrived';
}
arrived();
`;
const html =
  '<!doctype html><style>button, a, div, input { display: block; margin: 6px; }</style>' +
  '<button id="buy">Checkout</button><button id="guest">Checkout as guest</button>' +
  '<ul><li data-name="lamp"><span>Desk lamp</span> <button class="add">Add to cart</button></li>' +
  '<li data-name="mug"><span>Coffee mug</span> <button class="add">Add to cart</button></li></ul>' +
  '<button disabled>Sold out</button><div id="plain">Just some text</div>' +
  '<input id="code" placeholder="Coupon"><button id="apply">Apply</button>' +
  '<button id="slow">Slow</button><button id="jumpy">Jumpy</button><button id="three">Three</button><button id="broken">Broken</button>' +
  '<a id="next" href="/two">Next page</a><p id="out"></p><p id="cart"></p>' +
  // CLOSED_ORIGIN is a port that was just closed, filled in when the page is served.
  '<script>window.CLOSED = "CLOSED_ORIGIN";</script><script type="module" src="/app.js"></script>';
const htmlTwo = '<!doctype html><p id="here"></p><script type="module" src="/two.js"></script>';
// A sign-in page (D-139): the button says "Login", and a typed value must never come back.
const htmlLogin =
  "<!doctype html><h1>Login</h1><form onsubmit=\"document.getElementById('out').textContent = 'signed in'; return false\">" +
  '<input type="email" aria-label="Email"><input type="password" aria-label="Password">' +
  '<button type="submit">Login</button></form><p id="out"></p><button id="buy">Checkout</button>';

let server: http.Server;
let origin = '';
let closedOrigin = '';

beforeAll(async () => {
  const closed = http.createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  closedOrigin = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise((r) => closed.close(r));
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/app.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(appJs);
    if (path === '/two.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(pageTwoJs);
    if (path === '/two') return res.writeHead(200, { 'content-type': 'text/html' }).end(htmlTwo);
    if (path === '/login') return res.writeHead(200, { 'content-type': 'text/html' }).end(htmlLogin);
    if (path === '/api/orders') return res.writeHead(201).end('created');
    if (path === '/api/missing') return res.writeHead(404).end('nope');
    if (path === '/api/slow') {
      setTimeout(() => res.writeHead(200).end('slow'), 1500);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(html.replace('CLOSED_ORIGIN', closedOrigin));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

const action = (target: string, extra: Partial<ActionRequest> = {}): ActionRequest => ({
  protocolVersion: PROTOCOL_VERSION,
  target,
  ...extra,
});

/** Starts a collector on the test page, runs `act`, and returns what it sent and logged. */
async function withCollector<T>(
  act: (c: BrowserCollector, page: NonNullable<BrowserCollector['page']>) => Promise<T>,
  opts: { pressBudgetMs?: number; path?: string; send?: (m: IngestMessage) => void } = {},
) {
  const messages: IngestMessage[] = [];
  const logs: string[] = [];
  const collector = new BrowserCollector({
    url: `${origin}${opts.path ?? ''}`,
    headless: true,
    settleMs: 200,
    pressBudgetMs: opts.pressBudgetMs ?? 10_000,
    send: (m) => {
      messages.push(m);
      opts.send?.(m);
    },
    log: (m) => logs.push(m),
  });
  await collector.start();
  let result: T;
  try {
    const page = collector.page;
    if (!page) throw new Error('no page');
    await page.waitForSelector('#buy');
    await page.waitForTimeout(300); // the load-time reads
    result = await act(collector, page);
  } catch (err) {
    throw new Error(`${(err as Error).message}\ncollector log:\n${logs.join('\n')}`);
  } finally {
    await collector.stop();
  }
  const starts = messages.flatMap((m) => (m.type === 'traceStart' ? [m] : []));
  /** Executed ranges of the test page's own scripts in a trace, as `path#function@start-end`. */
  const executed = (traceId: string) =>
    messages
      .flatMap((m) =>
        m.type === 'delta' && m.phase === 'action' && m.traceId === traceId
          ? m.coverage
              .filter((s) => s.url.startsWith(origin))
              .flatMap((s) =>
                s.functions.flatMap((f) =>
                  f.ranges
                    .filter((r) => r.count > 0)
                    .map(
                      (r) => `${new URL(s.url).pathname}#${f.functionName}@${r.startOffset}-${r.endOffset}`,
                    ),
                ),
              )
          : [],
      )
      .sort();
  const ran = (traceId: string) =>
    [...new Set(executed(traceId).map((e) => e.split('@')[0]))].filter((e) => !e?.endsWith('#'));
  return { result, messages, starts, executed, ran, logs };
}

/** The e2e's human-style press: down, hold 80 ms, up. The reference trace. */
async function heldPress(page: NonNullable<BrowserCollector['page']>, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} not found`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 80));
  await page.mouse.up();
}

const traceEnds = (messages: IngestMessage[]) => messages.filter((m) => m.type === 'traceEnd').length;

describe.skipIf(!enabled)('run_action on a real browser', () => {
  it('gives the same trace as an 80 ms held press, at the press boundary', async () => {
    const { result, starts, executed, messages } = await withCollector(async (c, page) => {
      await heldPress(page, '#buy');
      await page.waitForSelector('#out:has-text("created")');
      await page.waitForTimeout(500); // let the held press's trace settle
      await page.evaluate(() => {
        const out = document.getElementById('out');
        if (out) out.textContent = '';
      });
      return c.runAction(action('button "Checkout"'));
    });
    expect(result).toMatchObject({ ok: true, boundary: 'press', settled: 'quiet' });
    if (!result.ok) return;
    expect(result.tagged).toEqual([{ method: 'POST', path: '/api/orders' }]);
    expect(starts.map((s) => s.label)).toEqual(['button: Checkout', 'button: Checkout']);
    const [held, synced] = starts;
    expect(synced?.traceId).toBe(result.traceId);
    expect(executed(synced?.traceId ?? '')).toEqual(executed(held?.traceId ?? ''));
    expect(executed(synced?.traceId ?? '').some((e) => e.startsWith('/app.js#pressed@'))).toBe(true);
    expect(traceEnds(messages)).toBe(2);
  }, 30_000);

  it('gives the same trace as an 80 ms held press, at the release boundary', async () => {
    const { result, starts, executed, logs } = await withCollector(
      async (c, page) => {
        // The first press's read is "too slow" at this budget, so the boundary moves to the release.
        await heldPress(page, '#guest');
        await page.waitForTimeout(500);
        await heldPress(page, '#buy');
        await page.waitForSelector('#out:has-text("created")');
        await page.waitForTimeout(500);
        return c.runAction(action('button "Checkout"'));
      },
      { pressBudgetMs: 0 },
    );
    expect(logs.some((l) => l.includes('clicks now start at the mouse release'))).toBe(true);
    expect(result).toMatchObject({ ok: true, boundary: 'release' });
    const [, held, synced] = starts;
    expect(starts.map((s) => s.label)).toEqual([
      'button: Checkout as guest',
      'button: Checkout',
      'button: Checkout',
    ]);
    expect(executed(synced?.traceId ?? '')).toEqual(executed(held?.traceId ?? ''));
    // At the release, pointerdown code ran before the boundary.
    expect(executed(synced?.traceId ?? '').some((e) => e.startsWith('/app.js#pressed@'))).toBe(false);
    expect(executed(synced?.traceId ?? '').some((e) => e.startsWith('/app.js#checkout@'))).toBe(true);
  }, 30_000);

  it('presses Enter and Space on a button through the key boundary', async () => {
    const { result, starts, ran } = await withCollector(async (c) => {
      const enter = await c.runAction(action('button "Checkout"', { action: 'press' }));
      const space = await c.runAction(
        action('button "Checkout as guest"', { action: 'press', key: 'Space' }),
      );
      return { enter, space };
    });
    expect(result.enter).toMatchObject({ ok: true, boundary: 'key' });
    expect(result.space).toMatchObject({ ok: true, boundary: 'key' });
    expect(starts.map((s) => s.label)).toEqual([
      'button: Checkout (Enter)',
      'button: Checkout as guest (Space)',
    ]);
    expect(ran(starts[0]?.traceId ?? '')).toContain('/app.js#checkout');
    expect(ran(starts[1]?.traceId ?? '')).toContain('/app.js#guest');
  }, 30_000);

  it('picks the one exact name over partial ones, and the row given by within', async () => {
    const { result, starts, ran } = await withCollector(async (c, page) => {
      const checkout = await c.runAction(action('button "Checkout"'));
      const mug = await c.runAction(action('button "Add to cart"', { within: 'Coffee mug' }));
      return { checkout, mug, cart: await page.textContent('#cart') };
    });
    expect(result.checkout.ok && result.mug.ok).toBe(true);
    expect(result.cart).toBe('mug;');
    expect(ran(starts[0]?.traceId ?? '')).toContain('/app.js#checkout');
    expect(ran(starts[1]?.traceId ?? '')).toContain('/app.js#addToCart');
  }, 30_000);

  it('answers ambiguous and not_found with candidates, and clicks nothing', async () => {
    const { result, starts } = await withCollector(async (c) => ({
      two: await c.runAction(action('button "Add to cart"')),
      typo: await c.runAction(action('button "Chekout"')),
      css: await c.runAction(action('css=#nope')),
      text: await c.runAction(action('Add to cart')),
    }));
    expect(result.two).toMatchObject({ ok: false, error: { code: 'ambiguous', count: 2 } });
    if (!result.two.ok) {
      expect(result.two.error.candidates).toEqual([
        'button "Add to cart" in "Desk lamp"',
        'button "Add to cart" in "Coffee mug"',
      ]);
    }
    expect(result.typo).toMatchObject({ ok: false, error: { code: 'not_found', count: 0 } });
    if (!result.typo.ok) expect(result.typo.error.candidates?.slice(0, 2)).toContain('button "Checkout"');
    expect(result.css).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(result.text).toMatchObject({ ok: false, error: { code: 'ambiguous', count: 2 } });
    expect(starts).toEqual([]);
  }, 30_000);

  it('says a miss on a sign-in page is a sign-in form, with a call built from its fields (D-139)', async () => {
    const { result, starts } = await withCollector(
      async (c, page) => {
        const missed = await c.runAction(
          action('button "Sign in"', {
            fill: [
              { target: 'textbox "Email"', value: SECRET },
              { target: 'textbox "Password"', value: SECRET },
            ],
          }),
        );
        const typo = await c.runAction(action('text=Upcoming'));
        // The call from the hint, with real values in place of the placeholders, signs in.
        const message = missed.ok ? '' : missed.error.message;
        const call = JSON.parse(message.split('run_action ')[1] ?? '{}') as ActionRequest;
        const followed = await c.runAction(
          action(call.target, {
            // An email field blocks the submit unless the value looks like an email.
            fill: (call.fill ?? []).map((f) => ({
              ...f,
              value: f.value === '<email>' ? 'me@example.test' : 'pw',
            })),
          }),
        );
        return { missed, typo, call, followed, out: await page.textContent('#out') };
      },
      { path: '/login' },
    );
    expect(result.missed).toMatchObject({ ok: false, error: { code: 'not_found' } });
    if (!result.missed.ok) {
      expect(result.missed.error.message).toContain('This page is a sign-in form (it has a password field)');
      expect(result.missed.error.message).not.toContain(SECRET);
      expect(result.missed.error.candidates?.[0]).toBe('button "Login"');
    }
    expect(result.call).toEqual({
      target: 'button "Login"',
      fill: [
        { target: 'textbox "Email"', value: '<email>' },
        { target: 'textbox "Password"', value: '<password>' },
      ],
    });
    // Any miss on the page gets it, not only a sign-in target.
    if (!result.typo.ok) expect(result.typo.error.message).toContain('sign-in form');
    expect(result.followed).toMatchObject({ ok: true });
    expect(result.out).toBe('signed in');
    expect(starts).toHaveLength(1);
  }, 30_000);

  it('answers not_actionable for a disabled button, without pressing', async () => {
    const { result, starts } = await withCollector(async (c) => c.runAction(action('button "Sold out"')));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_actionable' } });
    if (!result.ok) expect(result.error.message).toMatch(/disabled/);
    expect(starts).toEqual([]);
  }, 30_000);

  it('answers no_trace when the input opens no boundary (Space on a plain div)', async () => {
    const daemon = await startDaemon({ workspaceRoots: [process.cwd()], writeDiscoveryFile: false });
    try {
      const click = action('Just some text');
      const { result, starts, ran } = await withCollector(
        async (c) => {
          daemon.setActionRunner((r) => c.runAction(r));
          return {
            space: await c.runAction(action('Just some text', { action: 'press', key: 'Space' })),
            // A click on a plain div does open a trace: the hook pauses on every primary press
            // (the lead's ruling, 2026-11-01). No app code runs in it.
            click: await postAction(daemon.port, daemon.token, click),
          };
        },
        { send: (m) => daemon.correlator.ingest('browser', m) },
      );
      expect(result.space).toMatchObject({ ok: false, error: { code: 'no_trace' } });
      expect(result.click).toMatchObject({ ok: true, boundary: 'press' });
      expect(starts.map((s) => s.label)).toEqual(['div: Just some text']);
      expect(ran(starts[0]?.traceId ?? '')).toEqual([]);
      expect(describeActionResult(click, result.click)).toContain('no workspace code ran');
    } finally {
      daemon.setActionRunner(undefined);
      await daemon.close();
    }
  }, 30_000);

  it('runs two calls made at once one after the other, as two whole traces', async () => {
    const { result, starts, ran } = await withCollector(async (c) =>
      Promise.all([
        c.runAction(action('button "Checkout"')),
        c.runAction(action('button "Checkout as guest"')),
      ]),
    );
    const [buy, guest] = result;
    expect(buy).toMatchObject({ ok: true, tagged: [{ method: 'POST', path: '/api/orders' }] });
    expect(guest).toMatchObject({ ok: true, tagged: [] });
    expect(starts.map((s) => s.label)).toEqual(['button: Checkout', 'button: Checkout as guest']);
    expect(ran(starts[0]?.traceId ?? '')).toContain('/app.js#checkout');
    expect(ran(starts[1]?.traceId ?? '')).toEqual(['/app.js#guest']);
  }, 30_000);

  it('follows a link that navigates, keeping both pages in one trace', async () => {
    const { result, starts, ran } = await withCollector(async (c) => c.runAction(action('link "Next page"')));
    expect(result).toMatchObject({ ok: true, settled: 'quiet', pageUrl: `${origin}/two` });
    if (result.ok) expect(result.tagged).toEqual([{ method: 'GET', path: '/two' }]);
    expect(starts.map((s) => s.label)).toEqual(['a: Next page']);
    expect(ran(starts[0]?.traceId ?? '')).toContain('/two.js#arrived');
  }, 30_000);

  it('fills a field first without an extra boundary, and stops before any press when a field is missing', async () => {
    const { result, starts, ran } = await withCollector(async (c, page) => {
      const missing = await c.runAction(
        action('button "Checkout"', {
          fill: [
            { target: 'textbox "Coupon"', value: 'first' },
            { target: 'textbox "Nope"', value: 'second' },
          ],
        }),
      );
      const outAfterMissing = await page.textContent('#out');
      const filled = await c.runAction(
        action('css=#apply', { fill: [{ target: 'textbox "Coupon"', value: 'WELCOME10' }] }),
      );
      return { missing, outAfterMissing, filled, url: page.url() };
    });
    expect(result.missing).toMatchObject({ ok: false, error: { code: 'not_found', fillIndex: 1 } });
    if (!result.missing.ok) {
      expect(result.missing.error.message).toMatch(/^fill\[1\]/);
      expect(result.missing.error.message).not.toContain('second');
    }
    expect(result.outAfterMissing).toBe('');
    expect(result.filled).toMatchObject({ ok: true, boundary: 'press' });
    expect(result.url).toContain('code=WELCOME10');
    expect(starts).toHaveLength(1);
    expect(ran(starts[0]?.traceId ?? '')).toContain('/app.js#apply');
    // The typing ran before the boundary, so its input handler isn't in the action's trace.
    expect(ran(starts[0]?.traceId ?? '')).not.toContain('/app.js#echo');
  }, 30_000);

  it('answers not_actionable with the entry index when a fill target is not editable', async () => {
    const { result, starts } = await withCollector(async (c) =>
      c.runAction(
        action('button "Checkout"', { fill: [{ target: 'button "Checkout as guest"', value: 'x' }] }),
      ),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_actionable', fillIndex: 0 } });
    expect(starts).toEqual([]);
  }, 30_000);

  it('marks a trace that hit the settle cap, and a press whose click went elsewhere', async () => {
    const { result } = await withCollector(async (c) => ({
      slow: await c.runAction(action('button "Slow"', { timeoutMs: 500 })),
      jumpy: await c.runAction(action('button "Jumpy"')),
    }));
    expect(result.slow).toMatchObject({ ok: true, settled: 'timeout' });
    if (result.slow.ok) expect(result.slow.warnings.map((w) => w.code)).toEqual(['timeout']);
    expect(result.jumpy).toMatchObject({ ok: true });
    if (result.jumpy.ok) expect(result.jumpy.warnings.map((w) => w.code)).toEqual(['click_lost']);
  }, 30_000);

  it('reads coverage once before the first of three tagged requests, and not before the others (D-128)', async () => {
    const { result, messages, logs, starts } = await withCollector(async (c) =>
      c.runAction(action('button "Three"')),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.tagged).toHaveLength(3);
    const before = messages.filter((m) => m.type === 'delta' && m.beforeRequest);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      traceId: starts[0]?.traceId,
      beforeRequest: { method: 'POST', path: '/api/orders' },
    });
    expect(logs.filter((l) => l.startsWith('request read for'))).toHaveLength(1);
  }, 30_000);

  it('attaches a thrown error, a console.error, a 404 and a refused fetch to the click, once each (D-121)', async () => {
    const { result, messages, starts } = await withCollector(async (c, page) => {
      const r = await c.runAction(action('button "Broken"'));
      // After the trace: a problem now has no open trace, so it is dropped.
      await page.evaluate(() => console.error('outside any action'));
      await page.waitForTimeout(200);
      return r;
    });
    expect(result).toMatchObject({ ok: true });
    const problems = messages.flatMap((m) => (m.type === 'problem' ? [m] : []));
    for (const p of problems) expect(p.traceId).toBe(starts[0]?.traceId);
    const brief = problems
      .map(
        (p) =>
          `${p.kind} ${p.request ? `${p.request.method} ${p.request.path} ${p.request.status ?? 'failure'}` : p.message}`,
      )
      .sort();
    expect(brief).toEqual([
      'console-error broken: console says no',
      'exception TypeError: broken: thrown from a timer',
      'request-failed GET /api/missing 404',
      'request-failed GET /nothing failure',
    ]);
    const thrown = problems.find((p) => p.kind === 'exception');
    expect(thrown?.location?.url).toBe(`${origin}/app.js`);
  }, 30_000);

  it('never shows a fill value: not in tool output, the stored trace, or the collector log (rule 6)', async () => {
    const daemon = await startDaemon({ workspaceRoots: [process.cwd()], writeDiscoveryFile: false });
    try {
      const request = action('css=#apply', { fill: [{ target: 'textbox "Coupon"', value: SECRET }] });
      const { result, logs, messages } = await withCollector(
        async (c, page) => {
          daemon.setActionRunner((r) => c.runAction(r));
          const reply = await postAction(daemon.port, daemon.token, request);
          // The page did echo it: into the label (before the press), the URL and a console error.
          const echoed = { label: await page.textContent('#apply'), url: page.url() };
          return { reply, echoed };
        },
        { send: (m) => daemon.correlator.ingest('browser', m) },
      );
      expect(result.echoed.label).toBe(`Apply ${SECRET}`);
      expect(result.echoed.url).toContain(SECRET);
      expect(result.reply.ok).toBe(true);
      const output = describeActionResult(request, result.reply);
      expect(output).toContain('[redacted]');
      expect(output).not.toContain(SECRET);
      if (result.reply.ok) expect(result.reply.trace.label).toBe('button: Apply [redacted]');
      const stored = daemon.store.list().map((s) => JSON.stringify(daemon.store.get(s.id)));
      expect(stored.length).toBeGreaterThan(0);
      for (const t of stored) expect(t).not.toContain(SECRET);
      expect(logs.length).toBeGreaterThan(0);
      for (const l of logs) expect(l).not.toContain(SECRET);
      for (const m of messages) if (m.type === 'traceStart') expect(JSON.stringify(m)).not.toContain(SECRET);
    } finally {
      daemon.setActionRunner(undefined);
      await daemon.close();
    }
  }, 30_000);
});
