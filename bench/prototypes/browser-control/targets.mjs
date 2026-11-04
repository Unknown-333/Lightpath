// How an agent could name its target on the shop: visible text, role and name, CSS selector, or a
// ref from an accessibility snapshot (Playwright's ariaSnapshot mode 'ai'). Counts matches per name,
// and checks whether a snapshot ref still points at the same element after a re-render and a reload.
//
// Usage: pnpm build && node bench/prototypes/browser-control/targets.mjs [--out dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStack } from './harness.mjs';
import { METHODS } from './methods.mjs';

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'browser-raw');
mkdirSync(outDir, { recursive: true });
const stack = await startStack({ headless: true });
const { page } = stack;
const rows = [];
const count = async (how, name, locator) => {
  const n = await locator.count();
  rows.push({ how, name, matches: n });
};

await count('text', 'Add to cart', page.getByText('Add to cart'));
await count('text', 'Checkout', page.getByText('Checkout'));
await count('text', 'Coffee mug', page.getByText('Coffee mug'));
await count('role+name', 'button "Add to cart"', page.getByRole('button', { name: 'Add to cart' }));
await count('role+name', 'button "Checkout"', page.getByRole('button', { name: 'Checkout' }));
await count(
  'role+name in row',
  'listitem "Coffee mug" > button "Add to cart"',
  page.getByRole('listitem').filter({ hasText: 'Coffee mug' }).getByRole('button', { name: 'Add to cart' }),
);
await count('css', 'li:nth-child(2) button', page.locator('li:nth-child(2) button'));
await count('css', 'button.primary', page.locator('button.primary'));

const snap1 = await page.ariaSnapshot({ mode: 'ai' });
writeFileSync(join(outDir, 'targets-snapshot-1.txt'), snap1);
// Refs look like e20, or f1e20 after a reload (a new frame prefix).
const refOf = (snap, re) =>
  snap
    .split('\n')
    .find((l) => re.test(l))
    ?.match(/\[ref=(\w+)\]/)?.[1];
const mugRef = refOf(snap1, /button "Add to cart"/); // first Add to cart: Desk lamp
const checkoutRef = refOf(snap1, /button "Checkout"/);
await count('aria ref', `${checkoutRef} (Checkout)`, page.locator(`aria-ref=${checkoutRef}`));
await count('aria ref', `${mugRef} (first Add to cart)`, page.locator(`aria-ref=${mugRef}`));

// Re-render: add to cart (the cart now shows a subtotal), then resolve the old refs again.
// A held press: locator.click() loses its click under the collector (browser-control.md).
await METHODS['pw-mouse-hold']({ page }, 'li:nth-child(2) button');
await page.locator('text=/Subtotal:/').waitFor({ timeout: 3000 });
rows.push({ how: 'cart re-rendered', name: 'Subtotal shown', value: true });
const sameAfterRender = await page
  .locator(`aria-ref=${checkoutRef}`)
  .evaluate((el) => el.textContent)
  .catch((e) => `error: ${e.message.split('\n')[0]}`);
rows.push({ how: 'aria ref after re-render', name: checkoutRef, resolvesTo: sameAfterRender });
const snap2 = await page.ariaSnapshot({ mode: 'ai' });
writeFileSync(join(outDir, 'targets-snapshot-2.txt'), snap2);
rows.push({ how: 'aria ref in new snapshot', name: 'Checkout', ref: refOf(snap2, /button "Checkout"/) });

// Reload: refs from the old document.
await page.reload();
await page.waitForSelector('li:nth-child(2) button');
const afterReload = await page
  .locator(`aria-ref=${checkoutRef}`)
  .evaluate((el) => el.textContent, undefined, { timeout: 2000 })
  .catch((e) => `error: ${e.message.split('\n')[0]}`);
rows.push({ how: 'aria ref after reload', name: checkoutRef, resolvesTo: afterReload });
const snap3 = await page.ariaSnapshot({ mode: 'ai' });
writeFileSync(join(outDir, 'targets-snapshot-3.txt'), snap3);
rows.push({
  how: 'aria ref in snapshot after reload',
  name: 'Checkout',
  ref: refOf(snap3, /button "Checkout"/),
});
rows.push({ how: 'snapshot size', name: 'chars', value: snap1.length });

writeFileSync(join(outDir, 'targets.json'), JSON.stringify(rows, null, 2));
await stack.stop();
console.log(JSON.stringify(rows, null, 2));
process.exit(0);
