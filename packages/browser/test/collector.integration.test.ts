import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IngestMessage } from '@lightpath-dev/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserCollector } from '../src/collector.js';

// Launches a real browser, so it only runs when asked: LIGHTPATH_BROWSER_TESTS=1 pnpm test
const enabled = process.env.LIGHTPATH_BROWSER_TESTS === '1';

const appJs = `
export function checkout(total) {
  if (total > 100) {
    return 'free';
  }
  return fetch('/api/orders', { method: 'POST' }).then((r) => r.text());
}
document.getElementById('buy').addEventListener('click', () => {
  checkout(20).then((t) => { document.getElementById('out').textContent = t; });
});
export function applyCoupon(event) {
  event.preventDefault();
  document.getElementById('out').textContent = 'coupon ' + document.getElementById('code').value;
}
document.getElementById('coupon').addEventListener('submit', applyCoupon);
export function leaving() {
  window.leftAt = Date.now();
}
document.getElementById('next').addEventListener('click', leaving);
export function loadRemote() {
  return fetch(window.API + '/remote').then((r) => r.text()).then((t) => {
    document.getElementById('out').textContent = t;
  });
}
document.getElementById('remote').addEventListener('click', loadRemote);
`;
const pageTwoJs = `export function arrived() {
  document.getElementById('here').textContent = 'arrived';
}
arrived();
`;
const html = (api: string) =>
  '<!doctype html><button id="buy">Checkout</button><form id="coupon"><input id="code" placeholder="Coupon"></form>' +
  `<a id="next" href="/two">Next page</a><button id="remote">Remote</button><p id="out"></p>` +
  `<script>window.API = ${JSON.stringify(api)};</script><script type="module" src="/app.js"></script>`;
const htmlTwo = '<!doctype html><p id="here"></p><script type="module" src="/two.js"></script>';
// Each press lands on an element with a data-testid, or inside one (D-098). The first link is
// Actual's sidebar shape: a balance span with a test id inside the "All accounts" link.
const htmlLabels =
  '<!doctype html><style>a, button, div { display: block; margin: 8px; padding: 4px; }</style>' +
  '<a href="#accounts">All accounts <span data-testid="accounts-balance">1,234.00</span></a>' +
  '<button>Save <span data-testid="save-icon">*</span></button>' +
  '<div data-testid="card-total"><p id="total">Total</p></div>' +
  '<a href="#home" data-testid="nav-home">Home</a>' +
  '<div role="button">Open <span data-testid="open-count">3</span></div>';

let server: http.Server;
let origin = '';
const traceHeaders: (string | undefined)[] = [];
// An API on another loopback port whose CORS policy allows the page's origin but no custom headers,
// and which refuses preflights: a tagged request must still reach it (D-086).
let apiServer: http.Server;
let apiOrigin = '';
const apiSeen: { method: string | undefined; trace: string | undefined }[] = [];

beforeAll(async () => {
  apiServer = http.createServer((req, res) => {
    apiSeen.push({ method: req.method, trace: req.headers['x-lightpath-trace'] as string | undefined });
    if (req.method === 'OPTIONS') return res.writeHead(405).end();
    res.writeHead(200, { 'access-control-allow-origin': origin }).end('remote ok');
  });
  apiServer.listen(0, '127.0.0.1');
  await once(apiServer, 'listening');
  apiOrigin = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

  server = http.createServer((req, res) => {
    if (req.url === '/app.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(appJs);
    if (req.url === '/two.js')
      return res.writeHead(200, { 'content-type': 'text/javascript' }).end(pageTwoJs);
    if (req.url === '/sw.js')
      return res
        .writeHead(200, { 'content-type': 'text/javascript' })
        .end("self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));");
    if (req.url === '/sw-page')
      return res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(
          '<!doctype html><button id="buy">Checkout</button><p id="out"></p><form id="coupon"><input id="code"></form>' +
            '<a id="next" href="/two">Next</a><button id="remote">Remote</button>' +
            `<script>window.API = ${JSON.stringify(apiOrigin)}; window.swRegistered = Promise.race([` +
            "Promise.resolve().then(() => navigator.serviceWorker.register('/sw.js')).then(() => navigator.serviceWorker.ready).then(() => 'yes')," +
            " new Promise((r) => setTimeout(() => r('blocked'), 2000))]).catch(() => 'blocked');</script>" +
            '<script type="module" src="/app.js"></script>',
        );
    if (req.url === '/labels') return res.writeHead(200, { 'content-type': 'text/html' }).end(htmlLabels);
    if (req.url === '/two') {
      traceHeaders.push(req.headers['x-lightpath-trace'] as string | undefined);
      return res.writeHead(200, { 'content-type': 'text/html' }).end(htmlTwo);
    }
    if (req.url === '/api/orders') {
      traceHeaders.push(req.headers['x-lightpath-trace'] as string | undefined);
      return res.writeHead(201).end('created');
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(html(apiOrigin));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  apiServer?.close();
});

describe.skipIf(!enabled)('BrowserCollector with a real browser', () => {
  it('produces a trace for one click with the handler coverage and a tagged request', async () => {
    const messages: IngestMessage[] = [];
    const logs: string[] = [];
    const collector = new BrowserCollector({
      url: origin,
      headless: true,
      settleMs: 200,
      send: (m) => messages.push(m),
      log: (m) => logs.push(`${Date.now() % 100000} ${m}`),
    });
    await collector.start();
    try {
      // A human-like click: press, hold about 80 ms, release. Chrome drops the release if it
      // arrives while the page is paused at the boundary, so instant synthetic clicks
      // (page.mouse.click) aren't representative (ADR 0003).
      const box = await collector.page?.locator('#buy').boundingBox();
      if (!box) throw new Error('button not found');
      await collector.page?.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await collector.page?.mouse.down();
      await new Promise((r) => setTimeout(r, 80));
      await collector.page?.mouse.up();
      await collector.page?.waitForSelector('#out:has-text("created")', { timeout: 8000 });
      const deadline = Date.now() + 5000;
      while (!messages.some((m) => m.type === 'traceEnd') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (err) {
      throw new Error(`${(err as Error).message}\ncollector log:\n${logs.join('\n')}`);
    } finally {
      await collector.stop();
      if (process.env.LIGHTPATH_DEBUG === '1') console.log(`collector log:\n${logs.join('\n')}`);
    }

    const start = messages.find((m) => m.type === 'traceStart');
    expect(start).toMatchObject({ label: 'button: Checkout' });
    if (start?.type !== 'traceStart') return;
    expect(traceHeaders).toContain(start.traceId);

    const action = messages.find((m) => m.type === 'delta' && m.phase === 'action');
    if (action?.type !== 'delta') throw new Error('no action delta');
    // The click handler must land in the action delta, not the background one (ADR 0003).
    const background = messages.find((m) => m.type === 'delta' && m.phase === 'background');
    const bgCheckout =
      background?.type === 'delta'
        ? background.coverage.flatMap((s) => s.functions).find((f) => f.functionName === 'checkout')
        : undefined;
    expect(bgCheckout?.ranges[0]?.count ?? 0).toBe(0);
    const app = action.coverage.find((s) => s.url === `${origin}/app.js`);
    expect(app?.functions.find((f) => f.functionName === 'checkout')?.ranges[0]?.count).toBe(1);
    expect(messages.some((m) => m.type === 'source' && m.url === `${origin}/app.js`)).toBe(true);
  }, 30_000);

  /** Starts a collector, runs `act`, waits for `traces` traceEnd messages, and returns everything. */
  async function record(
    act: (c: BrowserCollector) => Promise<void>,
    traces = 1,
    pressBudgetMs?: number,
    path = '',
  ) {
    const messages: IngestMessage[] = [];
    const logs: string[] = [];
    const collector = new BrowserCollector({
      url: `${origin}${path}`,
      headless: true,
      settleMs: 200,
      ...(pressBudgetMs !== undefined ? { pressBudgetMs } : {}),
      send: (m) => messages.push(m),
      log: (m) => logs.push(m),
    });
    await collector.start();
    try {
      await act(collector);
      const deadline = Date.now() + 8000;
      while (messages.filter((m) => m.type === 'traceEnd').length < traces && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (err) {
      throw new Error(`${(err as Error).message}\ncollector log:\n${logs.join('\n')}`);
    } finally {
      await collector.stop();
    }
    /** Functions with count > 0 in this trace's action deltas, as `path#name`. */
    const ran = (traceId: string) =>
      messages.flatMap((m) =>
        m.type === 'delta' && m.phase === 'action' && m.traceId === traceId
          ? m.coverage.flatMap((s) =>
              s.functions
                .filter((f) => f.functionName && (f.ranges[0]?.count ?? 0) > 0)
                .map((f) => `${new URL(s.url).pathname}#${f.functionName}`),
            )
          : [],
      );
    const starts = messages.flatMap((m) => (m.type === 'traceStart' ? [m] : []));
    return { messages, starts, ran, logs };
  }

  it("tags a call to an API on another loopback port without a preflight, even when CORS doesn't allow the header", async () => {
    apiSeen.length = 0;
    const { starts, ran } = await record(async (c) => {
      const page = c.page;
      const box = await page?.locator('#remote').boundingBox();
      if (!page || !box) throw new Error('button not found');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await new Promise((r) => setTimeout(r, 80));
      await page.mouse.up();
      await page.waitForSelector('#out:has-text("remote ok")', { timeout: 8000 });
    });
    const [remote] = starts;
    if (!remote) throw new Error('no trace');
    expect(remote.label).toBe('button: Remote');
    expect(ran(remote.traceId)).toContain('/app.js#loadRemote');
    expect(apiSeen).toEqual([{ method: 'GET', trace: remote.traceId }]);
  }, 30_000);

  it('keeps API calls in the click on a page that registers a service worker (D-089)', async () => {
    traceHeaders.length = 0;
    let registered: unknown;
    const { starts } = await record(
      async (c) => {
        const page = c.page;
        if (!page) throw new Error('no page');
        registered = await page.evaluate(
          () => (window as unknown as { swRegistered: Promise<string> }).swRegistered,
        );
        // A worker controls the page from the next load; without blocking, the click's request
        // then reaches the server with no trace header (measured).
        await page.reload();
        await page.waitForTimeout(500);
        await page.focus('#buy');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#out:has-text("created")', { timeout: 8000 });
      },
      1,
      undefined,
      '/sw-page',
    );
    expect(registered).toBe('blocked');
    const [buy] = starts;
    if (!buy) throw new Error('no trace');
    expect(traceHeaders).toContain(buy.traceId);
  }, 30_000);

  it('opens a trace for Enter on a button and for Enter in a form field', async () => {
    const { starts, ran } = await record(async (c) => {
      const page = c.page;
      if (!page) throw new Error('no page');
      await page.focus('#buy');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#out:has-text("created")', { timeout: 8000 });
      await new Promise((r) => setTimeout(r, 400)); // let the first trace settle
      await page.fill('#code', 'WELCOME10');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#out:has-text("coupon WELCOME10")', { timeout: 8000 });
    }, 2);
    expect(starts.map((s) => s.label)).toEqual(['button: Checkout (Enter)', 'input: Coupon (Enter)']);
    const [buy, coupon] = starts;
    if (!buy || !coupon) throw new Error('missing traces');
    expect(ran(buy.traceId)).toContain('/app.js#checkout');
    expect(traceHeaders).toContain(buy.traceId);
    expect(ran(coupon.traceId)).toContain('/app.js#applyCoupon');
    expect(ran(coupon.traceId)).not.toContain('/app.js#checkout');
  }, 30_000);

  it("doesn't open a trace for typing, including Space in a text field", async () => {
    const { starts } = await record(async (c) => {
      await c.page?.fill('#code', '');
      await c.page?.focus('#code');
      await c.page?.keyboard.type('two words');
      await new Promise((r) => setTimeout(r, 400));
    }, 0);
    expect(starts).toEqual([]);
  }, 30_000);

  it('moves the boundary to the release when reads are slow, and keeps short presses working', async () => {
    const { starts, ran, logs } = await record(
      async (c) => {
        const page = c.page;
        const box = await page?.locator('#buy').boundingBox();
        if (!page || !box) throw new Error('button not found');
        await page.waitForTimeout(300); // the load-time read decides the boundary
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // A 10 ms press: at the press boundary, a pause this long would swallow the release.
        await page.mouse.down();
        await new Promise((r) => setTimeout(r, 10));
        await page.mouse.up();
        await page.waitForSelector('#out:has-text("created")', { timeout: 8000 });
      },
      1,
      0, // every read is "too slow": force the release boundary
    );
    expect(logs.some((l) => l.includes('clicks now start at the mouse release'))).toBe(true);
    expect(logs.some((l) => l.includes('boundary release'))).toBe(true);
    expect(starts.map((s) => s.label)).toEqual(['button: Checkout']);
    expect(ran(starts[0]?.traceId ?? '')).toContain('/app.js#checkout');
  }, 30_000);

  it('keeps the leaving page and the next page in one trace across a full navigation', async () => {
    const { starts, ran } = await record(async (c) => {
      const page = c.page;
      const box = await page?.locator('#next').boundingBox();
      if (!page || !box) throw new Error('link not found');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await new Promise((r) => setTimeout(r, 80));
      await page.mouse.up();
      await page.waitForSelector('#here:has-text("arrived")', { timeout: 8000 });
    });
    expect(starts.map((s) => s.label)).toEqual(['a: Next page']);
    const traceId = starts[0]?.traceId ?? '';
    // The click handler on the old page, read in beforeunload before the document went away.
    expect(ran(traceId)).toContain('/app.js#leaving');
    // The new page's startup code, and the page request itself tagged with the trace.
    expect(ran(traceId)).toContain('/two.js#arrived');
    expect(traceHeaders).toContain(traceId);
  }, 30_000);

  it('labels a click by its nearest control, and by a data-testid only outside any control (D-098)', async () => {
    const targets = [
      '[data-testid="accounts-balance"]',
      '[data-testid="save-icon"]',
      '#total',
      '[data-testid="nav-home"]',
      '[data-testid="open-count"]',
    ];
    const { starts } = await record(
      async (c) => {
        const page = c.page;
        if (!page) throw new Error('no page');
        for (const selector of targets) {
          const box = await page.locator(selector).boundingBox();
          if (!box) throw new Error(`${selector} not found`);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await new Promise((r) => setTimeout(r, 80));
          await page.mouse.up();
          await new Promise((r) => setTimeout(r, 400)); // let each trace settle
        }
      },
      targets.length,
      undefined,
      '/labels',
    );
    expect(starts.map((s) => s.label)).toEqual([
      'a: All accounts 1,234.00',
      'button: Save *',
      'div: card-total',
      'a: nav-home',
      'button: Open 3',
    ]);
  }, 30_000);
});
