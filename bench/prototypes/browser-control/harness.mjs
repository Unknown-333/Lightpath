// Shared setup for the browser-control prototypes (docs/research/browser-control.md): starts a
// daemon, the example shop under the Node agent, and a BrowserCollector, the way
// scripts/e2e-shop.mjs does. Adds a tap on every ingest message, the collector's log, and a small
// probe page (served by request interception on the shop's origin) for inputs the shop doesn't have.
import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = join(here, '..', '..', '..');
const shop = join(repo, 'examples', 'shop');
const dist = (pkg) => new URL(`../../../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv, UrlWatcher } = await import(dist('cli'));
export const { lineRanges } = await import(dist('mcp'));

/** CPU load in percent, read the way the owner asks for (Windows only; null elsewhere). */
export function cpuLoad() {
  if (process.platform !== 'win32') return null;
  const out = execSync(
    `powershell -NoProfile -Command "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue"`,
    { encoding: 'utf8' },
  );
  return Math.round(Number(out.trim()) * 10) / 10;
}

/** Reads CPU load; over 20 % waits 60 s and reads once more. Returns both readings. */
export async function loadGate(log) {
  const first = cpuLoad();
  if (first === null || first <= 20) return { first, busy: false };
  log(`cpu ${first}% > 20%: waiting 60 s`);
  await new Promise((r) => setTimeout(r, 60_000));
  const second = cpuLoad();
  return { first, second, busy: second > 20 };
}

const PROBE = join(here, 'probe');
const PROBE_TYPES = { html: 'text/html', js: 'text/javascript' };

/**
 * Starts daemon, shop and collector. `launchArgs` is passed to Chrome by patching playwright-core's
 * chromium.launch for this process only (used by attach-mcp.mjs to open a CDP port).
 */
export async function startStack({ headless = true, launchArgs } = {}) {
  if (launchArgs) {
    // The collector's own copy of playwright-core (pnpm keeps it under packages/browser).
    const { chromium } = createRequire(join(repo, 'packages', 'browser', 'package.json'))('playwright-core');
    const original = chromium.launch.bind(chromium);
    chromium.launch = (opts = {}) => original({ ...opts, args: [...(opts.args ?? []), ...launchArgs] });
  }
  const daemon = await startDaemon({ workspaceRoots: [shop] });
  const traces = new Map();
  /** First time (performance.now) each trace was seen ended, and seen with a Node file. */
  const seen = new Map();
  daemon.store.subscribe((t) => {
    traces.set(t.id, t);
    const s = seen.get(t.id) ?? { first: performance.now() };
    if (t.endedAt && !s.ended) s.ended = performance.now();
    if (t.files.some((f) => f.collector === 'node') && !s.node) s.node = performance.now();
    seen.set(t.id, s);
  });
  const child = spawn(process.execPath, ['dev.mjs'], {
    cwd: shop,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: agentEnv(process.env, { daemonUrl: daemon.url, token: daemon.token, roots: [shop], registerUrl }),
  });
  let childErr = '';
  child.stderr.on('data', (c) => {
    childErr += c;
  });
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

  const logs = [];
  const notices = [];
  /** Raw ingest messages from the browser collector: deltas carry function names and counts. */
  const messages = [];
  const collector = new BrowserCollector({
    url,
    headless,
    send: (m) => {
      messages.push({ at: performance.now(), m });
      daemon.correlator.ingest('browser', m);
    },
    log: (msg) => logs.push({ at: performance.now(), msg }),
    notice: (msg) => notices.push(msg),
  });
  await collector.start();
  const page = collector.page;
  // The probe page: our own route runs before the collector's (last registered wins).
  await page.route('**/__probe/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const ext = name.split('.').pop();
    route.fulfill({
      status: 200,
      contentType: PROBE_TYPES[ext],
      body: readFileSync(join(PROBE, name), 'utf8'),
    });
  });
  await page.waitForSelector('li:has-text("Coffee mug") button');
  const cdp = await page.context().newCDPSession(page);

  const stop = async () => {
    await cdp.detach().catch(() => {});
    await collector.stop().catch(() => {});
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else child.kill('SIGTERM');
    await daemon.close();
  };
  return {
    daemon,
    traces,
    seen,
    url,
    collector,
    page,
    cdp,
    logs,
    notices,
    messages,
    stop,
    shopPid: child.pid,
  };
}

/** The boundary and pause the collector logged for a trace: `click on X: paused Yms, boundary B, trace T`. */
export function boundaryOf(logs, traceId) {
  const line = logs.find((l) => l.msg.includes(`trace ${traceId}`) && l.msg.startsWith('click on'));
  const m = line?.msg.match(/paused ([\d.]+)ms, boundary (\w+)/);
  return m ? { pauseMs: Number(m[1]), boundary: m[2] } : {};
}

/** A trace reduced to what must match a human click: label, files with lines, requests. */
export function signature(t) {
  return {
    label: t.label,
    files: t.files
      .map((f) => `${f.path} [${f.collector}${f.background ? ', background' : ''}] ${lineRanges(f.lines)}`)
      .sort(),
    requests: (t.requests ?? []).map((r) => `${r.method} ${r.path} ${r.status}`),
  };
}

/** Names of functions that ran in this trace's browser action deltas. */
export function actionFunctions(messages, traceId) {
  const names = new Set();
  for (const { m } of messages) {
    if (m.type !== 'delta' || m.phase !== 'action' || m.traceId !== traceId) continue;
    for (const s of m.coverage)
      for (const f of s.functions) if (f.ranges[0]?.count > 0) names.add(f.functionName);
  }
  return [...names];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)] * 10) / 10;
}
