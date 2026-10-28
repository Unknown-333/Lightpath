import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IngestMessage } from '@lightpath/protocol';
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
`;
const html =
  '<!doctype html><button id="buy">Checkout</button><p id="out"></p><script type="module" src="/app.js"></script>';

let server: http.Server;
let origin = '';
const traceHeaders: (string | undefined)[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/app.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(appJs);
    if (req.url === '/api/orders') {
      traceHeaders.push(req.headers['x-lightpath-trace'] as string | undefined);
      return res.writeHead(201).end('created');
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
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
});
