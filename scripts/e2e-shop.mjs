// Golden end-to-end test (docs/ARCHITECTURE.md section 11): runs the example shop under Lightpath,
// clicks "Add to cart" and "Checkout" in a real browser, and checks that one trace contains the
// React component and the backend route, service, and payment code. Then asks for the same code
// through `lightpath mcp`, the way a coding agent would (the M5 exit check), and has the agent do
// Add to cart and Checkout itself with run_action, with no press from this script (build 1).
//
// Usage: pnpm build && node scripts/e2e-shop.mjs [--headed]
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
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

// The discovery file lets `lightpath mcp` find this daemon; close() removes it.
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
  // What `lightpath dev` does once the browser is open: run_action acts on this page (D-115).
  daemon.setActionRunner((request) => collector.runAction(request));
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

  // M5 exit check: a coding agent asks "which code handles Checkout?" through `lightpath mcp`,
  // as Claude Code or Cursor would, and gets this real trace's files and lines back.
  const requireMcp = createRequire(join(repo, 'packages', 'mcp', 'package.json'));
  const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
  const { describeTrace, MAX_CHARS } = await import(dist('mcp'));
  // 6.5 (D-116): the summary names every file; get_trace with `file` prints every lit line.
  const namesFile = (out, path) =>
    new RegExp(`^  ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`, 'm').test(out);
  const printedLines = (out) =>
    new Set(
      out
        .split('\n')
        .map((l) => /^ {0,3}(\d+) {2}/.exec(l)?.[1])
        .filter(Boolean)
        .map(Number),
    );
  const agent = new Client({ name: 'e2e-agent', version: '0.0.0' });
  await agent.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(repo, 'packages', 'cli', 'dist', 'bin.js'), 'mcp', '--root', shop],
    }),
  );
  try {
    const answer = await agent.callTool({ name: 'find_code_for_action', arguments: { action: 'Checkout' } });
    const text = answer.content?.[0]?.text ?? '';
    console.log(`\nfind_code_for_action("Checkout") →\n${text}\n`);
    check(
      text.startsWith(`Trace ${checkout?.id}: button: Checkout`),
      'MCP: find_code_for_action returns the Checkout trace',
    );
    for (const f of checkout?.files ?? []) {
      check(namesFile(text, f.path), `MCP: the summary names ${f.path}`);
    }
    check(text.includes('request: POST /api/orders → 201'), 'MCP: the answer includes the request');
    check(text.length <= MAX_CHARS, `MCP: find_code_for_action is at most 16,000 chars (${text.length})`);
    check(
      /^before POST \/api\/orders \[browser\]$/m.test(text) &&
        /^POST \/api\/orders → 201 \[node, \d+ ms\]$/m.test(text),
      'MCP: the summary has the "before POST /api/orders" and backend phases',
    );
    check(/^ {4}checkout 21-33 ×1/m.test(text), 'MCP: the summary lists Cart.tsx checkout 21-33 called once');
    const before = checkout ? describeTrace(checkout) : '';
    console.log(
      `SIZE Checkout before (describeTrace): ${before.length} chars, ${before.length / 4} chars/4; after (summary): ${text.length} chars, ${text.length / 4} chars/4`,
    );
    for (const f of checkout?.files ?? []) {
      const res = await agent.callTool({
        name: 'get_trace',
        arguments: { traceId: checkout.id, file: f.path },
      });
      const slice = res.content?.[0]?.text ?? '';
      if (f.path === 'server/routes/orders.ts') console.log(`\nget_trace(file: ${f.path}) →\n${slice}\n`);
      const shown = printedLines(slice);
      const missing = f.lines.map((l) => l.line).filter((l) => !shown.has(l));
      check(
        missing.length === 0 && slice.length <= MAX_CHARS,
        `MCP: get_trace with file ${f.path} prints every lit line (${f.lines.length}) in ${slice.length} chars${missing.length ? `; missing ${missing.join(',')}` : ''}`,
      );
    }

    // Build 1 (D-114): the agent clicks by itself with run_action. From here on the script sends no
    // press of its own; every action goes through `lightpath mcp` → POST /v1/action → this page.
    const runAction = async (args) => {
      const res = await agent.callTool({ name: 'run_action', arguments: args });
      const out = res.content?.[0]?.text ?? '';
      console.log(`\nrun_action(${JSON.stringify(args)}) →\n${out}\n`);
      const id = /^Trace (t_[a-z0-9]{12}):/.exec(out)?.[1];
      return { text: out, isError: res.isError === true, trace: id ? traces.get(id) : undefined };
    };
    const linesOf = (f) => f.lines.map((l) => l.line).join(',');

    const agentAdd = await runAction({ target: 'button "Add to cart"', within: 'Coffee mug' });
    check(
      agentAdd.text.includes('action: click button "Add to cart" within "Coffee mug" (boundary press'),
      'run_action: Add to cart (within "Coffee mug") was clicked at the press boundary',
    );
    check(
      agentAdd.trace?.label === 'button: Add to cart' &&
        agentAdd.trace.files.some((f) => f.path === 'src/App.tsx'),
      'run_action: the Add to cart trace includes src/App.tsx',
    );

    const agentCheckout = await runAction({ target: 'button "Checkout"' });
    const ct = agentCheckout.trace;
    check(
      agentCheckout.text.startsWith(`Trace ${ct?.id}: button: Checkout`),
      'run_action: Checkout returns its own trace in the same call',
    );
    check(namesFile(agentCheckout.text, 'src/Cart.tsx'), 'run_action: the answer lists src/Cart.tsx');
    check(
      namesFile(agentCheckout.text, 'server/routes/orders.ts'),
      'run_action: the answer lists server/routes/orders.ts',
    );
    check(
      agentCheckout.text.length <= MAX_CHARS,
      `run_action: the Checkout answer is at most 16,000 chars (${agentCheckout.text.length})`,
    );
    for (const f of ct?.files ?? []) {
      check(namesFile(agentCheckout.text, f.path), `run_action: the summary names ${f.path}`);
    }
    check(
      agentCheckout.text.includes('request: POST /api/orders → 201'),
      'run_action: the answer includes POST /api/orders → 201',
    );
    check(!agentCheckout.text.includes('warning ('), 'run_action: Checkout came back with no warnings');
    // The agent's Checkout must light exactly what the human-style press lit.
    const sameFiles =
      ct &&
      checkout &&
      ct.files
        .map((f) => f.path)
        .sort()
        .join() ===
        checkout.files
          .map((f) => f.path)
          .sort()
          .join() &&
      checkout.files.every(
        (f) => linesOf(f) === linesOf(ct.files.find((g) => g.path === f.path) ?? { lines: [] }),
      );
    check(
      Boolean(sameFiles),
      'run_action: Checkout has the same files and lines as the human-press Checkout',
    );
    if (!sameFiles && ct && checkout) {
      for (const f of [...checkout.files, ...ct.files]) console.log(`  ${f.path}: ${linesOf(f)}`);
    }

    // Typing first (fill), then the press: the coupon reaches the server and its discount line runs.
    await runAction({ target: 'button "Add to cart"', within: 'Coffee mug' });
    const coupon = await runAction({
      target: 'button "Checkout"',
      fill: [{ target: 'textbox "Coupon"', value: 'WELCOME10' }],
    });
    const pricingSrc = (await import('node:fs'))
      .readFileSync(join(shop, 'server/services/pricing.ts'), 'utf8')
      .split('\n');
    const discountLine = pricingSrc.findIndex((l) => l.includes('Math.round(subtotalCents * 0.1)')) + 1;
    const pricing = (t) => t?.files.find((f) => f.path === 'server/services/pricing.ts');
    check(
      discountLine > 0 && Boolean(pricing(coupon.trace)?.lines.some((l) => l.line === discountLine)),
      `run_action with fill: pricing.ts line ${discountLine} (the coupon discount) ran`,
    );
    check(
      !pricing(checkout)?.lines.some((l) => l.line === discountLine),
      `the human Checkout (no coupon) did not run pricing.ts line ${discountLine}`,
    );
    check(!coupon.text.includes('WELCOME10'), 'run_action: the filled value is not in the answer');

    // Nearby inputs on the real shop: a disabled button and a target that isn't there.
    const soldOut = await runAction({ target: 'button "Sold out"' });
    check(
      soldOut.isError && soldOut.text.includes('not_actionable') && soldOut.text.includes('disabled'),
      'run_action: the disabled "Sold out" button is not_actionable',
    );
    const typo = await runAction({ target: 'button "Chekout"' });
    check(
      typo.isError && typo.text.includes('not_found') && typo.text.includes('  button "Checkout"'),
      'run_action: a misspelled target is not_found and lists button "Checkout"',
    );

    // Build 4 (D-121, D-123): a failed request and a thrown error show in the Checkout trace, and
    // secrets seeded in a header, a body, a query and an error message never come back. The shop
    // has no bug of its own here, so the test seeds them: 6 desk lamps when 5 are in stock (the
    // server answers 409), and a listener added to the page that throws and sends a request.
    for (let i = 0; i < 6; i++) await runAction({ target: 'button "Add to cart"', within: 'Desk lamp' });
    const SEED = {
      header: 'seed-header-7f3a',
      body: 'seed-body-91c2',
      query: 'seed-query-4be0',
      thrown: 'seed-thrown-d5e8',
    };
    await page.evaluate((seed) => {
      document.querySelector('button.primary').addEventListener(
        'click',
        () => {
          fetch(`/api/orders?token=${seed.query}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${seed.header}` },
            body: JSON.stringify({ lines: [], note: seed.body }),
          });
          setTimeout(() => {
            throw new Error(`e2e seeded error: password=${seed.thrown}`);
          }, 0);
        },
        { once: true },
      );
    }, SEED);
    const broken = await runAction({ target: 'button "Checkout"' });
    console.log(
      `SIZE Checkout with problems: ${broken.text.length} chars, ${broken.text.length / 4} chars/4`,
    );
    check(
      /^errors: 1 \(first: Error: e2e seeded error: password=\[redacted\]/m.test(broken.text),
      'build 4: the thrown error is in the Checkout trace, its secret redacted',
    );
    check(
      /^failed requests: 2 \(first: POST \/api\/orders → \d{3}\)$/m.test(broken.text) &&
        broken.trace?.problems?.some((p) => p.request?.status === 409),
      'build 4: the failed requests (409 out of stock, 400 empty cart) are in the Checkout trace',
    );
    check(
      broken.text.length <= MAX_CHARS,
      `build 4: the Checkout answer is at most 16,000 chars (${broken.text.length})`,
    );
    const outputs = [broken.text];
    for (const [name, args] of [
      ['find_code_for_action', { action: 'Checkout' }],
      ['get_trace', { traceId: broken.trace?.id }],
      ['list_traces', {}],
      ['diff_traces', { a: ct?.id, b: broken.trace?.id }],
    ]) {
      const res = await agent.callTool({ name, arguments: args });
      outputs.push(res.content?.[0]?.text ?? '');
    }
    const leaked = Object.values(SEED).filter((s) => outputs.some((o) => o.includes(s)));
    check(
      leaked.length === 0,
      `build 4: no seeded secret in any tool output (${leaked.join(', ') || 'none'})`,
    );
    check(
      outputs[4].includes('problems: errors 0 → 1'),
      'build 4: diff_traces shows the error that appeared',
    );
  } finally {
    await agent.close();
  }
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

// Build 4 (D-122): nothing is running now. An agent's first tool call starts Lightpath by itself
// from the shop's config, and run_action works on the browser it opened.
const shopConfig = join(shop, 'lightpath.config.json');
const API_PORT_URL = 'http://127.0.0.1:3001';
const free = async (url) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const up = await fetch(url).then(
      () => true,
      () => false,
    );
    if (!up) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
if (failures.length === 0) {
  const fs = await import('node:fs');
  let auto;
  try {
    check(await free(API_PORT_URL), 'auto-start: the first stage stopped and freed the API port');
    fs.writeFileSync(shopConfig, JSON.stringify({ command: 'node dev.mjs', autoStart: true }));
    const requireMcp = createRequire(join(repo, 'packages', 'mcp', 'package.json'));
    const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
    auto = new Client({ name: 'e2e-auto', version: '0.0.0' });
    await auto.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(repo, 'packages', 'cli', 'dist', 'bin.js'), 'mcp', '--root', shop],
      }),
    );
    const call = async (args) => {
      const res = await auto.callTool({ name: 'run_action', arguments: args });
      const out = res.content?.[0]?.text ?? '';
      console.log(`\nauto-start run_action(${JSON.stringify(args)}) →\n${out}\n`);
      return out;
    };
    const first = await call({ target: 'button "Add to cart"', within: 'Coffee mug' });
    check(
      first.startsWith(
        'started lightpath dev ("node dev.mjs") in the background; log: .lightpath/dev.log\nTrace t_',
      ),
      'auto-start: the first run_action started lightpath dev and returned its trace',
    );
    check(
      fs.existsSync(join(shop, '.lightpath', 'dev.log')),
      'auto-start: lightpath dev logs to .lightpath/dev.log',
    );
    const out = await call({ target: 'button "Checkout"' });
    check(
      out.startsWith('Trace t_') &&
        /^ {2}src\/Cart\.tsx$/m.test(out) &&
        /^ {2}server\/routes\/orders\.ts$/m.test(out),
      'auto-start: run_action Checkout gets src/Cart.tsx and server/routes/orders.ts, with no start line',
    );
  } catch (err) {
    failures.push(String(err?.stack ?? err));
    console.error(err);
  } finally {
    await auto?.close().catch(() => {});
    check(await free(API_PORT_URL), 'auto-start: closing the MCP client stopped lightpath dev and the shop');
    fs.rmSync(shopConfig, { force: true });
    fs.rmSync(join(shop, '.lightpath', 'dev.log'), { force: true });
  }
}

if (failures.length === 0) console.log('\nE2E PASSED');
else console.log(`\nE2E FAILED (${failures.length})\n${failures.map((f) => `- ${f}`).join('\n')}`);
process.exit(failures.length === 0 ? 0 : 1);
