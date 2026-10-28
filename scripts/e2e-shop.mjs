// Golden end-to-end test (docs/ARCHITECTURE.md section 11): runs the example shop under Lightpath,
// clicks "Add to cart" and "Checkout" in a real browser, and checks that one trace contains the
// React component and the backend route, service, and payment code.
//
// Usage: pnpm build && node scripts/e2e-shop.mjs [--headed]
import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const shop = join(repo, 'examples', 'shop');
const dist = (pkg) => new URL(`../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv, formatTrace, UrlWatcher } = await import(dist('cli'));

const headed = process.argv.includes('--headed');
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const daemon = await startDaemon({ workspaceRoots: [shop], writeDiscoveryFile: false });
const traces = new Map();
daemon.store.subscribe((t) => traces.set(t.id, t));

const child = spawn(process.execPath, ['dev.mjs'], {
  cwd: shop,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: agentEnv(process.env, { daemonUrl: daemon.url, token: daemon.token, roots: [shop], registerUrl }),
});
let childErr = '';
child.stderr.on('data', (c) => {
  childErr += c;
});

let collector;
try {
  const url = await new Promise((resolve, reject) => {
    const watcher = new UrlWatcher();
    const timer = setTimeout(() => reject(new Error(`dev server didn't start:\n${childErr}`)), 30_000);
    child.stdout.on('data', (c) => {
      const found = watcher.push(String(c));
      if (found) {
        clearTimeout(timer);
        resolve(found);
      }
    });
  });
  console.log(`shop running at ${url}`);
  daemon.correlator.addDevServer(new URL(url).origin, shop);

  collector = new BrowserCollector({
    url,
    headless: !headed,
    send: (m) => daemon.correlator.ingest('browser', m),
  });
  await collector.start();
  const page = collector.page;
  await page.waitForSelector('li:has-text("Desk lamp") button');

  // A human-like press: Chrome drops the release if it arrives during the boundary pause (ADR 0003).
  const press = async (selector) => {
    const box = await page.locator(selector).first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await new Promise((r) => setTimeout(r, 80));
    await page.mouse.up();
  };
  const waitForTrace = async (label, needNode) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const t = [...traces.values()].find(
        (x) => x.label === label && x.endedAt && (!needNode || x.files.some((f) => f.collector === 'node')),
      );
      if (t) return t;
      await new Promise((r) => setTimeout(r, 100));
    }
    return [...traces.values()].find((x) => x.label === label);
  };

  await press('li:has-text("Desk lamp") button');
  const add = await waitForTrace('button: Add to cart', false);
  if (add) console.log(`\n${formatTrace(add)}\n`);
  check(
    add?.files.some((f) => f.path === 'src/App.tsx'),
    '"Add to cart" trace includes src/App.tsx',
  );
  check(
    !add?.files.some((f) => f.collector === 'node'),
    '"Add to cart" trace has no backend code (no request was made)',
  );

  await press('button:has-text("Checkout")');
  await page.waitForSelector('text=/Order #\\d+ placed/', { timeout: 10_000 });
  const checkout = await waitForTrace('button: Checkout', true);
  if (checkout) console.log(`\n${formatTrace(checkout)}\n`);

  const file = (path) => checkout?.files.find((f) => f.path === path);
  check(
    file('src/Cart.tsx')?.collector === 'browser',
    'Checkout trace includes src/Cart.tsx from the browser',
  );
  check(file('src/api.ts')?.collector === 'browser', 'Checkout trace includes src/api.ts from the browser');
  check(
    file('server/routes/orders.ts')?.collector === 'node',
    'Checkout trace includes server/routes/orders.ts from Node',
  );
  check(Boolean(file('server/services/pricing.ts')), 'Checkout trace includes server/services/pricing.ts');
  check(Boolean(file('server/services/payment.ts')), 'Checkout trace includes server/services/payment.ts');
  check(
    checkout?.requests.some((r) => r.method === 'POST' && r.path === '/api/orders' && r.status === 201),
    'Checkout trace records POST /api/orders → 201',
  );

  // The empty-cart branch in orders.ts didn't run, so its line must not be lit.
  const ordersSrc = (await import('node:fs'))
    .readFileSync(join(shop, 'server/routes/orders.ts'), 'utf8')
    .split('\n');
  const emptyLine = ordersSrc.findIndex((l) => l.includes("'Your cart is empty.'")) + 1;
  check(
    emptyLine > 0 && !file('server/routes/orders.ts')?.lines.some((l) => l.line === emptyLine),
    `orders.ts line ${emptyLine} (empty-cart branch, not taken) is not lit`,
  );
  // The 'Order #… placed' line in Cart.tsx ran after the response, inside the same click.
  const cartSrc = (await import('node:fs')).readFileSync(join(shop, 'src/Cart.tsx'), 'utf8').split('\n');
  const okLine = cartSrc.findIndex((l) => l.includes('placed:')) + 1;
  check(
    Boolean(file('src/Cart.tsx')?.lines.some((l) => l.line === okLine)),
    `Cart.tsx line ${okLine} (success message) is lit`,
  );
} catch (err) {
  failures.push(String(err?.stack ?? err));
  console.error(err);
} finally {
  await collector?.stop().catch(() => {});
  // dev.mjs has its own children (API, Vite); kill the whole tree.
  if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  else child.kill('SIGTERM');
  await daemon.close();
}

console.log(failures.length === 0 ? '\nE2E PASSED' : `\nE2E FAILED (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
