// Triggers "Add to cart" (Coffee mug) then "Checkout" N times with one control method and records
// every trace. Coffee mug has stock 20, so 20 orders fit one fresh shop (the in-memory db resets).
//
// Usage: pnpm build && node bench/prototypes/browser-control/run.mjs <method> [--headed] [--n 20] [--out dir]
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boundaryOf, cpuLoad, loadGate, signature, sleep, startStack } from './harness.mjs';
import { METHODS } from './methods.mjs';

const args = process.argv.slice(2);
const method = args[0];
const headed = args.includes('--headed');
const n = Number(args[args.indexOf('--n') + 1]) || 20;
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'browser-raw');
if (!METHODS[method]) throw new Error(`unknown method ${method}; one of ${Object.keys(METHODS).join(', ')}`);

const ADD = 'li:nth-child(2) button'; // Coffee mug
const CHECKOUT = 'button.primary';
const mode = headed ? 'headed' : 'headless';
mkdirSync(join(outDir, 'runs'), { recursive: true });
const file = join(outDir, 'runs', `${method}-${mode}.jsonl`);
writeFileSync(file, '');
const write = (o) => appendFileSync(file, `${JSON.stringify(o)}\n`);

const gate = await loadGate(console.log);
const stack = await startStack({ headless: !headed });
const { page, cdp, traces, seen, logs } = stack;
const chrome = stack.messages.find((x) => x.m.type === 'hello')?.m.runtime?.version;
write({
  kind: 'start',
  method,
  mode,
  n,
  chrome,
  cpuStart: gate,
  at: new Date().toISOString(),
  url: stack.url,
});

/** Waits for a trace that wasn't there before `before`, ended, and with a Node file if `needNode`. */
async function waitForNew(before, needNode, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = [...traces.values()].filter((t) => !before.has(t.id));
    // Ended, and with a Node file when one is needed. An ended trace still without one 1.5 s later
    // is taken as it is (the click never sent the request); the row says noNode.
    const done = fresh.find((t) => {
      const s = seen.get(t.id);
      return s?.ended && (!needNode || s.node || performance.now() - s.ended > 1500);
    });
    if (done) return { trace: done, fresh };
    await sleep(10);
  }
  return { trace: undefined, fresh: [...traces.values()].filter((t) => !before.has(t.id)) };
}

const timeout = method === 'eval-click' ? 3000 : 10_000;

async function act(i, action, css, needNode) {
  const before = new Set(traces.keys());
  const t0 = performance.now();
  let error;
  try {
    await METHODS[method]({ page, cdp, logs }, css);
  } catch (err) {
    error = String(err.message).split('\n')[0];
  }
  const sent = performance.now() - t0;
  const { trace, fresh } = error ? { fresh: [] } : await waitForNew(before, needNode, timeout);
  const s = trace ? seen.get(trace.id) : undefined;
  const noNode = Boolean(s && needNode && !s.node);
  const ready = s && !noNode ? Math.max(s.ended, needNode ? s.node : 0) - t0 : null;
  const row = {
    kind: 'action',
    i,
    action,
    sentMs: Math.round(sent * 10) / 10,
    readyMs: ready === null ? null : Math.round(ready * 10) / 10,
    error,
    newTraces: fresh.length,
    ...(noNode ? { noNode } : {}),
    traceId: trace?.id,
    settled: trace?.settled,
    ...(trace ? boundaryOf(logs, trace.id) : {}),
    ...(trace ? signature(trace) : {}),
  };
  write(row);
  return row;
}

const notice = () =>
  page
    .locator('p.notice')
    .textContent({ timeout: 100 })
    .catch(() => null);

let failures = 0;
for (let i = 0; i < n; i++) {
  const ordersBefore = await notice();
  const add = await act(i, 'add', ADD, false);
  // The app's own effect, independent of Lightpath: the cart has a subtotal.
  const added = await page
    .locator('text=/Subtotal:/')
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  const checkout = await act(i, 'checkout', CHECKOUT, true);
  let status = await notice();
  for (let w = 0; w < 20 && status === ordersBefore; w++) {
    await sleep(100);
    status = await notice();
  }
  write({
    kind: 'effect',
    i,
    added,
    status,
    placed: /Order #\d+ placed/.test(status ?? '') && status !== ordersBefore,
  });
  if (!add.traceId || !checkout.traceId) failures++;
}

write({ kind: 'end', failures, notices: stack.notices, cpuEnd: cpuLoad(), at: new Date().toISOString() });
writeFileSync(join(outDir, 'runs', `${method}-${mode}.log`), logs.map((l) => l.msg).join('\n'));
await stack.stop();
console.log(`${method} ${mode}: ${n} iterations, ${failures} with a missing trace -> ${file}`);
process.exit(0);
