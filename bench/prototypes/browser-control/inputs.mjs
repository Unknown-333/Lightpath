// Nearby inputs on the probe page (probe/), for every control method: a press with pointerdown,
// mousedown and click handlers and a request; a click with no request; a link that navigates; a form
// submitted with Enter (or its button); a target that isn't there; two presses in quick succession.
// Checks which named handlers ran inside each trace, from the raw coverage deltas.
//
// Usage: pnpm build && node bench/prototypes/browser-control/inputs.mjs [--headed] [--out dir]
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionFunctions, boundaryOf, cpuLoad, loadGate, sleep, startStack } from './harness.mjs';
import { METHODS } from './methods.mjs';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(process.cwd(), 'browser-raw');
const mode = headed ? 'headed' : 'headless';
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `inputs-${mode}.jsonl`);
writeFileSync(file, '');
const write = (o) => appendFileSync(file, `${JSON.stringify(o)}\n`);

const KEY_METHODS = new Set(['pw-keyboard', 'cdp-key']);
const gate = await loadGate(console.log);
const stack = await startStack({ headless: !headed });
const { page, cdp, traces, seen, logs, messages } = stack;
const probeUrl = `${stack.url.replace(/\/$/, '')}/__probe/probe.html`;
write({ kind: 'start', mode, cpuStart: gate, at: new Date().toISOString() });

async function openProbe() {
  await page.goto(probeUrl);
  await page.waitForSelector('#press');
  await sleep(300); // let the load reads (D-081) finish before the first action
}

async function waitSettled(before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const fresh = [...traces.values()].filter((t) => !before.has(t.id));
    const allEnded = fresh.length > 0 && fresh.every((t) => seen.get(t.id)?.ended);
    if (fresh.length !== lastCount) {
      lastCount = fresh.length;
      stableSince = Date.now();
    }
    // Done when every new trace has ended and no new one appeared for 500 ms.
    if (allEnded && Date.now() - stableSince > 500) return fresh;
    await sleep(20);
  }
  return [...traces.values()].filter((t) => !before.has(t.id));
}

async function trial(method, input, css, { twice = false, timeoutMs = 4000 } = {}) {
  const before = new Set(traces.keys());
  const t0 = performance.now();
  let error;
  try {
    await METHODS[method]({ page, cdp, logs }, css);
    if (twice) await METHODS[method]({ page, cdp, logs }, css);
  } catch (err) {
    error = String(err.message).split('\n')[0];
  }
  const errorMs = error ? Math.round((performance.now() - t0) * 10) / 10 : undefined;
  const fresh = error ? [] : await waitSettled(before, timeoutMs);
  const out = await page
    .locator('#out')
    .textContent({ timeout: 200 })
    .catch(() => null);
  const row = {
    kind: 'trial',
    method,
    input,
    error,
    errorMs,
    out,
    traces: fresh.map((t) => ({
      id: t.id,
      label: t.label,
      settled: t.settled,
      readyMs: seen.get(t.id)?.ended ? Math.round((seen.get(t.id).ended - t0) * 10) / 10 : null,
      ...boundaryOf(logs, t.id),
      functions: actionFunctions(messages, t.id)
        .filter((f) => f.startsWith('probe'))
        .sort(),
      requests: (t.requests ?? []).map((r) => `${r.method} ${r.path} ${r.status}`),
    })),
  };
  write(row);
  return row;
}

for (const method of Object.keys(METHODS)) {
  const key = KEY_METHODS.has(method);
  await openProbe();
  for (let r = 0; r < 3; r++) await trial(method, 'press', '#press');
  for (let r = 0; r < 3; r++) await trial(method, 'no-request', '#local');
  for (let r = 0; r < 3; r++) {
    if (key) await page.fill('#q', `abc${r}`);
    await trial(method, 'form', key ? '#q' : '#form button');
  }
  await trial(method, 'missing', '#nope');
  for (let r = 0; r < 3; r++) await trial(method, 'twice', '#press', { twice: true });
  await trial(method, 'link', '#nav', { timeoutMs: 6000 });
}

write({ kind: 'end', cpuEnd: cpuLoad(), notices: stack.notices, at: new Date().toISOString() });
writeFileSync(join(outDir, `inputs-${mode}.log`), logs.map((l) => l.msg).join('\n'));
await stack.stop();
console.log(`inputs ${mode} -> ${file}`);
process.exit(0);
