// Benchmark: what does Lightpath cost a real large app? Actual Budget (docs/tested-apps.md)
//
// Starts Actual's two processes with concurrently, the way docs/tested-apps.md describes: the
// Express sync server (`node build/app.js`, port 5006) and the Vite frontend (port 3001). Runs twice:
//   1. Plain: sends sequential requests straight to the sync server (no browser).
//   2. Under Lightpath: the same requests with the Node agent reporting to a real daemon and
//      LIGHTPATH_DEBUG=1, so every coverage read is logged; then opens the demo budget in the real
//      BrowserCollector and clicks the sidebar links (Reports, Schedules, All accounts, Budget)
//      round after round with a human-like press (held 80 ms). The press pause comes from the
//      collector's log; each coverage read's time and size from a wrapper on Playwright's CDP
//      session (see "Every coverage read" below), so the closing read is timed too.
// The server is measured with direct HTTP requests because the demo budget sends it none. They
// cycle through GET /account/needs-bootstrap, GET /account/validate and GET /sync/list-user-files,
// which the frontend sends when it connects to a server and signs in.
//
// Not measured: Actual runs its budget engine in a Web Worker, and Lightpath doesn't collect
// Worker code, so the engine's work costs no read and isn't in any trace.
//
// Setup (once, outside this repo; Actual's own scripts use POSIX shell, so on Windows):
//   git clone https://github.com/actualbudget/actual && cd actual
//   set ELECTRON_SKIP_BINARY_DOWNLOAD=1 && yarn install
//   yarn workspace @actual-app/sync-server build
// The server uses a fresh temporary data folder per run, set up with a throwaway password. It runs
// with NODE_ENV=development, as Actual's own `start:server-dev` does; otherwise its rate limit
// (500 requests a minute) answers 429 partway through the requests.
//
// Usage: pnpm build && node bench/actual.mjs --actual <path to actual> [--requests 600] [--rounds 50] [--details out.json] [--headed]
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const dist = (pkg) => new URL(`../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector, isNoiseScript, launchBrowser } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv } = await import(dist('cli'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ACTUAL = arg('actual', process.env.ACTUAL_DIR);
const REQUESTS = Number(arg('requests', '600'));
const ROUNDS = Number(arg('rounds', '50'));
const HEADED = process.argv.includes('--headed');
const WARMUP = 30;
const SERVER = 'http://localhost:5006';
const WEB = 'http://localhost:3001';
const PASSWORD = 'lightpath-bench';
const LINKS = [
  { text: 'Reports', path: /\/reports/ },
  { text: 'Schedules', path: /\/schedules/ },
  { text: 'All accounts', path: /\/accounts/ },
  { text: 'Budget', path: /\/budget/ },
];

if (!ACTUAL || !existsSync(join(ACTUAL, 'packages', 'sync-server', 'build', 'app.js'))) {
  console.error(
    'Pass --actual <dir>: a clone of actualbudget/actual with the sync server built (see the header).',
  );
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
};
const ms = (v) => v.toFixed(2);
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colors
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Starts both processes under one concurrently; returns the child and its combined output. */
function startActual(env) {
  const command =
    'npx -y concurrently@8 -k -n server,web "cd packages/sync-server && set NODE_ENV=development&& node build/app.js" ' +
    '"cd packages/desktop-client && set PORT=3001&& set REACT_APP_BACKEND_WORKER_HASH=dev&& npx vite --mode=browser"';
  const child = spawn(command, { cwd: ACTUAL, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  const out = { text: '' };
  child.stdout.on('data', (c) => {
    out.text += c;
  });
  child.stderr.on('data', (c) => {
    out.text += c;
  });
  return { child, out };
}

function stopActual(child) {
  // concurrently has its own children (the server, Vite); kill the whole tree this script started.
  if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitUp(url, child, out) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Actual exited:\n${out.text.slice(-3000)}`);
    try {
      const res = await fetch(url);
      await res.arrayBuffer();
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`${url} did not answer in 300 s:\n${out.text.slice(-3000)}`);
}

/** The coverage reads the sync server's agent logged so far (lines from concurrently's "server"). */
const serverTakes = (out) =>
  plain(out.text)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('[server]'))
    .flatMap((l) => {
      const m = /take ([\d.]+) ms, (\d+) functions in delta/.exec(l);
      return m ? [{ ms: Number(m[1]), functions: Number(m[2]) }] : [];
    });

/** Signs in (setting the password up on a fresh data folder) and returns a session token. */
async function signIn() {
  const boot = await (await fetch(`${SERVER}/account/needs-bootstrap`)).json();
  const post = (path, body) =>
    fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const res = boot.data.bootstrapped
    ? await post('/account/login', { loginMethod: 'password', password: PASSWORD })
    : await post('/account/bootstrap', { password: PASSWORD });
  if (res.status !== 'ok' || !res.data?.token) throw new Error(`sign-in failed: ${JSON.stringify(res)}`);
  return res.data.token;
}

/** Sends warmup + timed requests; returns latencies and the take counts at the window's edges. */
async function sendRequests(token, out) {
  const paths = ['/account/needs-bootstrap', '/account/validate', '/sync/list-user-files'];
  const latencies = [];
  let fromTake = 0;
  for (let i = 0; i < WARMUP + REQUESTS; i++) {
    if (i === WARMUP) {
      await sleep(500); // let the warmup's log lines arrive
      fromTake = serverTakes(out).length;
    }
    const t = performance.now();
    const res = await fetch(`${SERVER}${paths[i % paths.length]}`, { headers: { 'x-actual-token': token } });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`${paths[i % paths.length]} -> ${res.status}`);
    if (i >= WARMUP) latencies.push(performance.now() - t);
  }
  await sleep(500);
  return { latencies, fromTake, toTake: serverTakes(out).length };
}

const dataDir = mkdtempSync(join(os.tmpdir(), 'lightpath-bench-actual-'));
const baseEnv = {
  ...process.env,
  ACTUAL_DATA_DIR: dataDir,
  BROWSER: 'none',
  ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
};

// 1. Plain run.
let plainLatencies;
{
  console.error('plain run: starting Actual');
  const { child, out } = startActual({ ...baseEnv, NODE_OPTIONS: '' });
  try {
    await waitUp(`${SERVER}/info`, child, out);
    await waitUp(WEB, child, out);
    plainLatencies = (await sendRequests(await signIn(), out)).latencies;
  } finally {
    stopActual(child);
  }
  await sleep(2000);
}

// Every coverage read the collector makes, timed from the outside: the bench wraps the `send` of
// Playwright's CDPSession class (shared by the collector's session) for Profiler.takePreciseCoverage.
// Nothing in packages/ changes. Each read returns only functions that ran since the previous read
// (V8 resets its counters and leaves out functions that didn't run), so "page size" is the union of
// every function any read has returned so far, dependencies and the test driver's injected scripts
// included: the functions V8 has compiled in the page, all of which a read goes through.
const reads = []; // { at, ms, returned, pageSize }
const seen = new Set();
{
  const probe = await launchBrowser({ headless: true });
  try {
    const page = await probe.newPage();
    const proto = Object.getPrototypeOf(await page.context().newCDPSession(page));
    const send = proto.send;
    proto.send = async function (method, params) {
      if (method !== 'Profiler.takePreciseCoverage') return send.call(this, method, params);
      const pageSize = seen.size;
      const at = performance.now();
      const res = await send.call(this, method, params);
      const took = performance.now() - at;
      let returned = 0;
      let app = 0;
      for (const s of res.result) {
        const isApp = !isNoiseScript(s.url);
        for (const f of s.functions) {
          returned++;
          if (isApp) app++;
          seen.add(`${s.scriptId}:${f.ranges[0]?.startOffset}:${f.functionName}`);
        }
      }
      reads.push({ at, ms: took, returned, app, pageSize });
      return res;
    };
  } finally {
    await probe.close();
  }
}

// 2. Under Lightpath.
const daemon = await startDaemon({ workspaceRoots: [ACTUAL], writeDiscoveryFile: false });
const logs = [];
const pageEvents = []; // main-frame navigations and loads, to see whether a click reloads the page
const pageRequests = []; // every request Chrome sends that isn't to the Vite dev server
const DETAILS = arg('details', undefined);
const pressed = []; // what each press was aimed at, in order (Lightpath's own label can differ)
const pressedAt = []; // performance.now() just before each press
let traceEnds = 0;
const notices = [];
let server;
let clickPhaseTakes = [];
const traces = new Map();
daemon.store.subscribe((t) => traces.set(t.id, t));
{
  console.error('Lightpath run: starting Actual under the agent');
  const env = {
    ...agentEnv(baseEnv, { daemonUrl: daemon.url, token: daemon.token, roots: [ACTUAL], registerUrl }),
    LIGHTPATH_DEBUG: '1',
  };
  const { child, out } = startActual(env);
  let collector;
  try {
    await waitUp(`${SERVER}/info`, child, out);
    await waitUp(WEB, child, out);
    const firstTake = serverTakes(out)[0];
    const sent = await sendRequests(await signIn(), out);
    const takes = serverTakes(out);
    server = {
      firstFunctions: firstTake?.functions ?? takes[0]?.functions ?? 0,
      firstMs: firstTake?.ms ?? takes[0]?.ms ?? Number.NaN,
      steady: takes.slice(sent.fromTake, sent.toTake).map((t) => t.ms),
      latencies: sent.latencies,
    };
    console.error(`Lightpath run: ${server.steady.length} server reads in the timed window`);

    daemon.correlator.addDevServer(WEB, join(ACTUAL, 'packages', 'desktop-client'));
    collector = new BrowserCollector({
      url: WEB,
      headless: !HEADED,
      send: (m) => {
        if (m.type === 'traceEnd') traceEnds++;
        daemon.correlator.ingest('browser', m);
      },
      log: (m) => logs.push(m),
      notice: (m) => notices.push(m),
    });
    await collector.start();
    const page = collector.page;
    const t0 = Date.now();
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame())
        pageEvents.push({ ms: Date.now() - t0, event: 'navigated', url: f.url(), click: pressed.length });
    });
    page.on('load', () =>
      pageEvents.push({ ms: Date.now() - t0, event: 'load', url: page.url(), click: pressed.length }),
    );
    page.on('request', (r) => {
      if (!r.url().startsWith(WEB))
        pageRequests.push({ ms: Date.now() - t0, method: r.method(), url: r.url(), click: pressed.length });
    });
    const press = async (what, selector) => {
      const target = page.locator(selector).first();
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error(`nothing to press: ${selector}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      pressed.push(what);
      pressedAt.push(performance.now());
      await page.mouse.down();
      await sleep(80);
      await page.mouse.up();
    };
    // Waits until every click so far has closed its trace, so the next press never cuts one short.
    const settled = async (n) => {
      const deadline = Date.now() + 15_000;
      while (traceEnds < n && Date.now() < deadline) await sleep(50);
      await sleep(150);
    };

    await page.waitForSelector('button:has-text("Try the demo")', { timeout: 120_000 });
    await press('"Try the demo" button', 'button:has-text("Try the demo")');
    await page.waitForURL(/\/budget/, { timeout: 120_000 });
    await page.waitForSelector('a:visible:has-text("Reports")', { timeout: 120_000 });
    await settled(1);
    await sleep(3000); // the budget page keeps loading after its URL changes
    const takesBefore = serverTakes(out).length;
    let n = 1;
    for (let r = 0; r < ROUNDS; r++) {
      for (const link of LINKS) {
        await press(`sidebar "${link.text}" link`, `a:visible:has-text("${link.text}")`);
        await page.waitForURL(link.path, { timeout: 30_000 });
        await settled(++n);
      }
      console.error(`round ${r + 1}/${ROUNDS}`);
    }
    await sleep(1000);
    clickPhaseTakes = serverTakes(out)
      .slice(takesBefore)
      .map((t) => t.ms);
  } finally {
    await collector?.stop().catch(() => {});
    stopActual(child);
    await daemon.close();
  }
}
await sleep(1000);
rmSync(dataDir, { recursive: true, force: true });
if (reads.length === 0) throw new Error('no coverage reads were timed: the CDPSession wrapper did not apply');

// One record per press. Its reads are the ones that started between this press and the next: the
// press read (inside the pause, collector.ts #click) and the closing read (after the settle window).
const pauses = logs.flatMap((l) => {
  const m = /^click on (.*): paused ([\d.]+)ms, boundary (\w+), trace (\S+)/.exec(l);
  return m ? [{ label: m[1], pause: Number(m[2]), boundary: m[3], trace: m[4] }] : [];
});
const clicks = pressed.map((what, i) => {
  const mine = reads.filter(
    (r) => r.at >= pressedAt[i] && (i + 1 >= pressed.length || r.at < pressedAt[i + 1]),
  );
  const p = pauses[i];
  const trace = p ? traces.get(p.trace) : undefined;
  const browserFiles = (trace?.files ?? []).filter((f) => f.collector === 'browser' && !f.background);
  return {
    pressed: what,
    label: p?.label,
    pause: p?.pause ?? Number.NaN,
    boundary: p?.boundary,
    reads: mine.length,
    pageSize: mine[0]?.pageSize ?? Number.NaN,
    pressRead: mine[0],
    closingRead: mine.at(-1),
    browserFiles: browserFiles.length,
    requests: trace?.requests.length ?? 0,
  };
});
const odd = clicks.filter((c) => c.reads !== 2).length;
if (odd > 0) console.error(`warning: ${odd} presses did not have exactly 2 coverage reads`);
if (pauses.length !== pressed.length)
  console.error(`warning: ${pressed.length} presses but ${pauses.length} pauses logged`);
if (DETAILS)
  writeFileSync(DETAILS, JSON.stringify({ clicks, reads, pageEvents, pageRequests, logs }, null, 2));

// Click 0 is "Try the demo" on the start screen; its trace holds the demo budget's load. Click 1 is
// the first on the budget page, reported separately like the other benches' first click.
const demo = clicks[0];
const first = clicks[1];
const steady = clicks.slice(2);
const f1 = (v) => v.toFixed(1);

const cpu = os.cpus()[0]?.model.trim() ?? 'unknown CPU';
console.log(`\nActual Budget, Node ${process.version}, ${os.type()} ${os.release()}, ${cpu}\n`);
console.log(`Sync server: ${REQUESTS} direct HTTP requests after ${WARMUP} warmup, each run\n`);
console.log(
  '| Functions in first read | Read: first | Reads timed | Read per request: p50 / p99 | Latency without Lightpath: p50 / p99 | Latency with Lightpath: p50 / p99 |',
);
console.log('| --- | --- | --- | --- | --- | --- |');
console.log(
  `| ${server.firstFunctions} | ${ms(server.firstMs)} ms | ${server.steady.length} | ${ms(pct(server.steady, 50))} / ${ms(pct(server.steady, 99))} ms | ${ms(pct(plainLatencies, 50))} / ${ms(pct(plainLatencies, 99))} ms | ${ms(pct(server.latencies, 50))} / ${ms(pct(server.latencies, 99))} ms |`,
);
const toServer = pageRequests.filter((r) => r.url.startsWith(SERVER)).length;
console.log(
  `\nRequests Chrome sent to the sync server during the whole browser run: ${toServer}; sync-server reads during the clicks: ${clickPhaseTakes.length}`,
);

console.log(
  `\nFrontend: demo budget, ${ROUNDS} rounds of the sidebar links ${LINKS.map((l) => l.text).join(', ')}, headless Chrome, press held 80 ms\n`,
);
console.log(
  '| Pressed | Clicks | Page size at the press (p50) | Press pause: p50 / p99 / max | Closing read: functions / app functions / browser files (p50) | Closing read time: p50 / p99 |',
);
console.log('| --- | --- | --- | --- | --- | --- |');
const row = (what, these) => {
  const p50 = (fn) => pct(these.map(fn), 50);
  const p99 = (fn) => pct(these.map(fn), 99);
  const pause = (c) => c.pause;
  const closingMs = (c) => c.closingRead?.ms ?? Number.NaN;
  const cells = [
    what,
    these.length,
    p50((c) => c.pageSize),
    `${f1(p50(pause))} / ${f1(p99(pause))} / ${f1(Math.max(...these.map(pause)))} ms`,
    `${p50((c) => c.closingRead?.returned ?? 0)} / ${p50((c) => c.closingRead?.app ?? 0)} / ${p50((c) => c.browserFiles)}`,
    `${f1(p50(closingMs))} / ${f1(p99(closingMs))} ms`,
  ];
  console.log(`| ${cells.join(' | ')} |`);
};
row('All sidebar links', steady);
for (const what of [...new Set(steady.map((c) => c.pressed))])
  row(
    what,
    steady.filter((c) => c.pressed === what),
  );

const pressReturned = steady.map((c) => c.pressRead?.returned ?? 0);
const pressApp = steady.map((c) => c.pressRead?.app ?? 0);
const pressMs = pct(
  steady.map((c) => c.pressRead?.ms ?? Number.NaN),
  50,
);
console.log(
  `\nPress reads: ${steady.length}; app functions returned: ${pressApp.filter((x) => x === 0).length} returned none, max ${Math.max(...pressApp)}; all functions returned (dependencies, Vite, the test driver's injected scripts included): p50 ${pct(pressReturned, 50)}, max ${Math.max(...pressReturned)}; read time p50 ${f1(pressMs)} ms`,
);
const closingApp = steady.map((c) => c.closingRead?.app ?? 0);
console.log(`Closing reads: app functions p50 ${pct(closingApp, 50)}`);
console.log(
  `Page size: ${Math.min(...steady.map((c) => c.pageSize))} to ${Math.max(...steady.map((c) => c.pageSize))} functions over the clicks`,
);
console.log(`Boundary over the timed clicks: ${[...new Set(steady.map((c) => c.boundary))].join(', ')}`);
console.log(`Lightpath labels: ${[...new Set(steady.map((c) => `${c.pressed} = ${c.label}`))].join('; ')}`);
console.log(
  `\n${demo?.pressed} on the start screen: page size ${demo?.pageSize}, paused ${f1(demo?.pause)} ms, boundary ${demo?.boundary}; its closing read (the budget opening): ${demo?.closingRead?.returned} functions in ${f1(demo?.closingRead?.ms)} ms, ${demo?.browserFiles} browser files`,
);
console.log(
  `First click on the budget page: ${first?.pressed}, page size ${first?.pageSize}, paused ${f1(first?.pause)} ms; closing read ${first?.closingRead?.returned} functions in ${f1(first?.closingRead?.ms)} ms, ${first?.browserFiles} browser files`,
);
const demoEvents = pageEvents
  .filter((e) => e.click === 1)
  .map((e) => `${e.event} ${new URL(e.url).pathname}`);
console.log(`Page events after "Try the demo": ${demoEvents.join(', ') || 'none'}`);
console.log(
  `Full page loads during the sidebar clicks: ${pageEvents.filter((e) => e.click > 1 && e.event === 'load').length}`,
);
console.log(
  `Clicks with an empty closing read or trace: ${steady.filter((c) => !c.closingRead?.returned || c.browserFiles === 0).length}`,
);
for (const m of notices) console.log(`\nNOTICE: ${m}`);
console.log(
  "\nNot collected: Actual's budget engine runs in a Web Worker, and Lightpath doesn't read Worker coverage, so that code costs no read and is in no trace.",
);
