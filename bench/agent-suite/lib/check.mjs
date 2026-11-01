// Runs a bug's hidden check against a trial folder. The check lives in the suite, never in the trial.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_DIR } from './common.mjs';
import { API_URL, startShop, WEB_URL } from './shop.mjs';

// The suite borrows the repo's own Playwright (packages/browser depends on playwright-core).
const requireFromBrowser = createRequire(join(REPO_DIR, 'packages', 'browser', 'package.json'));

class CheckFailure extends Error {}

/** Helpers every check gets. Checks test behaviour (API responses, rendered text), never code. */
function makeKit(state) {
  const kit = {
    apiUrl: API_URL,
    webUrl: WEB_URL,
    expect(condition, message) {
      if (!condition) throw new CheckFailure(message);
    },
    async api(path, init) {
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON; keep the text
      }
      return { status: res.status, body };
    },
    order(lines, coupon) {
      return kit.api('/api/orders', { method: 'POST', body: coupon ? { lines, coupon } : { lines } });
    },
    /** A fresh page on the shop, with the product list loaded. */
    async page({ waitForProducts = true } = {}) {
      if (!state.browser) {
        const { chromium } = requireFromBrowser('playwright-core');
        state.browser = await chromium.launch({ headless: true });
      }
      const page = await state.browser.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(WEB_URL);
      if (waitForProducts)
        await page
          .getByRole('button', { name: /add to cart|sold out/i })
          .first()
          .waitFor();
      return page;
    },
    /** Clicks the "Add to cart" button in the row whose text matches `productName`, `times` times. */
    async add(page, productName, times = 1) {
      const row = page.locator('li', { hasText: productName });
      for (let i = 0; i < times; i++) await row.getByRole('button').click();
    },
    async checkout(page) {
      await page.getByRole('button', { name: /checkout/i }).click();
    },
    /** Waits up to `ms` for visible text matching `pattern`; returns the match or null. */
    async findText(page, pattern, ms = 5000) {
      try {
        const loc = page.getByText(pattern).first();
        await loc.waitFor({ state: 'visible', timeout: ms });
        return (await loc.textContent())?.trim() ?? '';
      } catch {
        return null;
      }
    },
    async bodyText(page) {
      // biome-ignore lint/performance/useDomNodeTextContent: Playwright's innerText is the text a user sees, for messages
      return (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    },
  };
  return kit;
}

/**
 * Starts the trial's shop, runs `<bugDir>/check.mjs`, stops the shop.
 * Returns { pass, detail, ms }. Any exception, a shop that won't start, or a timeout is a fail.
 */
export async function runCheck({ bugDir, trialDir, logFile, timeoutMs = 120_000 }) {
  const started = Date.now();
  const state = { browser: null };
  let shop = null;
  try {
    shop = await startShop(trialDir, logFile);
    const mod = await import(`${pathToFileURL(join(bugDir, 'check.mjs')).href}?t=${Date.now()}`);
    const kit = makeKit(state);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CheckFailure(`check timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    try {
      const detail = await Promise.race([mod.default(kit), timeout]);
      return { pass: true, detail: detail ?? 'ok', ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const detail = err instanceof CheckFailure ? err.message : `error: ${err?.stack ?? err}`;
    return { pass: false, detail, ms: Date.now() - started };
  } finally {
    await state.browser?.close().catch(() => {});
    shop?.stop();
  }
}
