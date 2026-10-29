// In-editor test: does the extension really light up lines in VS Code?
//
// Runs the example shop under Lightpath (daemon, Node agent, headless Chrome), then launches a
// separate copy of VS Code with the extension and test/editor/suite.cjs inside it. The suite opens
// Cart.tsx and orders.ts, asks this script to click Checkout (POST /click), and checks which lines
// the extension drew. VS Code gets its own profile in a temp folder, so an open VS Code isn't touched.
//
// Usage: pnpm build && pnpm bundle && node extensions/vscode/test/editor/run.mjs
// Downloads VS Code stable into extensions/vscode/.vscode-test on the first run (about 150 MB).
// Set LIGHTPATH_VSCODE_VERSION to test another version, for example 1.101.0 (the oldest supported:
// the first VS Code on Node 22, which the extension needs for the global WebSocket).
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..', '..');
const repo = join(extension, '..', '..');
const shop = join(repo, 'examples', 'shop');
const dist = (pkg) => new URL(`../../../../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv, UrlWatcher } = await import(dist('cli'));

// The extension activates on .lightpath/daemon.json, so the daemon writes it before VS Code starts.
const daemon = await startDaemon({ workspaceRoots: [shop] });
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
let control;
const profile = mkdtempSync(join(tmpdir(), 'lightpath-vscode-'));
let exitCode = 1;
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
  daemon.correlator.addDevServer(new URL(url).origin, shop);
  collector = new BrowserCollector({
    url,
    headless: true,
    send: (m) => daemon.correlator.ingest('browser', m),
  });
  await collector.start();
  const page = collector.page;
  await page.waitForSelector('li:has-text("Desk lamp") button');

  // Same human-like press as scripts/e2e-shop.mjs (ADR 0003).
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
    throw new Error(`no finished "${label}" trace within 10 s`);
  };

  // The suite calls this once its editors are open, so the trace arrives live, as for a user.
  control = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/click') return void res.writeHead(404).end();
    void (async () => {
      await press('li:has-text("Desk lamp") button');
      await waitForTrace('button: Add to cart', false);
      await press('button:has-text("Checkout")');
      await page.waitForSelector('text=/Order #\\d+ placed/', { timeout: 10_000 });
      return waitForTrace('button: Checkout', true);
    })().then(
      (trace) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(trace)),
      (err) => res.writeHead(500).end(String(err?.stack ?? err)),
    );
  });
  await new Promise((r) => control.listen(0, '127.0.0.1', r));

  exitCode = await runTests({
    version: process.env.LIGHTPATH_VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath: extension,
    extensionTestsPath: join(here, 'suite.cjs'),
    extensionTestsEnv: {
      LIGHTPATH_TEST_CONTROL: `http://127.0.0.1:${control.address().port}`,
      LIGHTPATH_TEST_SHOP: shop,
    },
    launchArgs: [
      shop,
      '--disable-extensions', // only the extension under test
      `--user-data-dir=${join(profile, 'user')}`,
      `--extensions-dir=${join(profile, 'extensions')}`,
    ],
  }).then(
    () => 0,
    (err) => {
      console.error(`VS Code tests failed: ${err?.message ?? err}`);
      return 1;
    },
  );
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  control?.close();
  await collector?.stop().catch(() => {});
  if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  else child.kill('SIGTERM');
  await daemon.close(); // also removes .lightpath/daemon.json
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(exitCode === 0 ? '\nVS CODE TEST PASSED' : '\nVS CODE TEST FAILED');
process.exit(exitCode);
