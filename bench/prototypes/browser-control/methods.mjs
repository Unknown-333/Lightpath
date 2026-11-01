// Ways an agent could trigger an action in the page Lightpath controls. Each takes the collector's
// Playwright page, a separate CDP session on the same page, and a CSS selector, and resolves once the
// input has been sent. None of them waits for the trace; run.mjs does that.
import { sleep } from './harness.mjs';

/** Centre of the element in viewport pixels, read over CDP. Throws if nothing matches. */
async function centre(cdp, css) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return null;
      el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  if (!result.value) throw new Error(`no element matches ${css}`);
  return result.value;
}

const mouse = (cdp, type, { x, y }) =>
  cdp.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mousePressed' ? 1 : 0,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });

async function pwBox(page, css) {
  const box = await page.locator(css).first().boundingBox({ timeout: 2000 });
  if (!box) throw new Error(`no element matches ${css}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const METHODS = {
  /** Playwright's locator.click(): actionability checks, then press and release with no hold. */
  'pw-locator-click': ({ page }, css) => page.locator(css).click({ timeout: 2000 }),
  /** The e2e press (scripts/e2e-shop.mjs): move, down, hold 80 ms, up. The reference. */
  'pw-mouse-hold': async ({ page }, css) => {
    const p = await pwBox(page, css);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
  },
  /**
   * The proposed tool: press, wait until the collector has taken the boundary and resumed the page
   * (its "click on …" log line; capped at 200 ms for the release boundary, where the press doesn't
   * pause), then release. No fixed hold, and the release can't land inside the pause.
   */
  'pw-mouse-synced': async ({ page, logs }, css) => {
    const p = await pwBox(page, css);
    await page.mouse.move(p.x, p.y);
    const before = logs.filter((l) => l.msg.startsWith('click on')).length;
    await page.mouse.down();
    const deadline = performance.now() + 200;
    while (
      performance.now() < deadline &&
      logs.filter((l) => l.msg.startsWith('click on')).length === before
    ) {
      await sleep(1);
    }
    await page.mouse.up();
  },
  /** page.mouse.click() with no delay, the case ADR 0003 says loses the click. */
  'pw-mouse-instant': async ({ page }, css) => {
    const p = await pwBox(page, css);
    await page.mouse.click(p.x, p.y);
  },
  /** locator.press('Enter'): focus, then a key press (keyboard boundary, D-079). */
  'pw-keyboard': ({ page }, css) => page.locator(css).press('Enter', { timeout: 2000 }),
  /** Raw CDP Input.dispatchMouseEvent, each event awaited, 80 ms hold. */
  'cdp-mouse-hold': async ({ cdp }, css) => {
    const p = await centre(cdp, css);
    await mouse(cdp, 'mouseMoved', p);
    await mouse(cdp, 'mousePressed', p);
    await sleep(80);
    await mouse(cdp, 'mouseReleased', p);
  },
  /** Raw CDP, press awaited, then release at once. */
  'cdp-mouse-instant': async ({ cdp }, css) => {
    const p = await centre(cdp, css);
    await mouse(cdp, 'mouseMoved', p);
    await mouse(cdp, 'mousePressed', p);
    await mouse(cdp, 'mouseReleased', p);
  },
  /** Raw CDP, press and release sent together without waiting for the press's reply (a real mouse). */
  'cdp-mouse-nowait': async ({ cdp }, css) => {
    const p = await centre(cdp, css);
    await mouse(cdp, 'mouseMoved', p);
    await Promise.all([mouse(cdp, 'mousePressed', p), mouse(cdp, 'mouseReleased', p)]);
  },
  /** Raw CDP Input.dispatchKeyEvent Enter on the focused element. */
  'cdp-key': async ({ cdp }, css) => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return false; el.focus(); return true; })()`,
      returnByValue: true,
    });
    if (!result.value) throw new Error(`no element matches ${css}`);
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...key });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  },
  /** element.click() through Runtime.evaluate: a synthetic click event, no pointer or key events. */
  'eval-click': async ({ cdp }, css) => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return false; el.click(); return true; })()`,
      returnByValue: true,
    });
    if (!result.value) throw new Error(`no element matches ${css}`);
  },
};
