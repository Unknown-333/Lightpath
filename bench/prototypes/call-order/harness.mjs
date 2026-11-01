// Runs the example shop under the real Lightpath pipeline (daemon, Node agent, BrowserCollector),
// clicks "Add to cart" then "Checkout" N times, and saves everything the call-order study needs:
// the daemon's trace, the raw coverage deltas behind it, and whatever extra signal the condition
// collects. analyze.mjs turns the saved runs into numbers.
//
// Conditions:
//   P   plain examples/shop, pipeline only (sizes of summaries and slices)
//   G0  ground-truth copy (make-gt.mjs), pipeline only: the cost baseline for the techniques
//   A   G0 + coverage reads when /api/orders leaves the page and when its response comes back
//   B   G0 + CDP Network.requestWillBeSent initiator stacks (async stack depth 32)
//   C   G0 + sampling CPU profiler in the page and per request in Node (100 us interval)
//   E   G0 + a CDP breakpoint at the start of every app function in the page, logging each hit
//
// Usage: pnpm build && node bench/prototypes/call-order/harness.mjs --condition G0 --runs 20 --out <dir>
// Ports come from examples/shop (server/index.ts, vite.config.ts).
import { execSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGt } from './make-gt.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dist = (pkg) => new URL(`../../../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv, UrlWatcher } = await import(dist('cli'));

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const condition = arg('--condition', 'G0');
const runs = Number(arg('--runs', '20'));
const out = arg('--out', join(repo, '..', 'callorder-raw'));
const SAMPLE_US = Number(arg('--interval', '100'));
if (!['P', 'G0', 'A', 'B', 'C', 'E'].includes(condition)) throw new Error(`unknown condition ${condition}`);
mkdirSync(out, { recursive: true });
const runFile = join(out, `runs-${condition}.jsonl`);
writeFileSync(runFile, '');
const say = (s) => {
  console.log(s);
  appendFileSync(join(out, `harness-${condition}.log`), `${s}\n`);
};

const appRoot = condition === 'P' ? join(repo, 'examples', 'shop') : makeGt();
const gt = condition !== 'P';
const daemon = await startDaemon({ workspaceRoots: [appRoot], writeDiscoveryFile: false });

// Every ingest message, from the page and from Node, on its way into the daemon.
const scripts = new Map(); // `${agentId}|${scriptId}` -> info
const sources = new Map(); // hash -> source
const deltas = []; // { agentId, message }
let activeTrace;
const realIngest = daemon.correlator.ingest.bind(daemon.correlator);
daemon.correlator.ingest = (agentId, m) => {
  if (m.type === 'scripts') for (const s of m.scripts) scripts.set(`${agentId}|${s.scriptId}`, s);
  else if (m.type === 'source') sources.set(m.hash, m.source);
  else if (m.type === 'delta' && m.phase === 'action') deltas.push({ agentId, message: m });
  else if (m.type === 'traceStart') activeTrace = m.traceId;
  realIngest(agentId, m);
};
const traces = new Map();
daemon.store.subscribe((t) => traces.set(t.id, t));

const env = agentEnv(process.env, {
  daemonUrl: daemon.url,
  token: daemon.token,
  roots: [appRoot],
  registerUrl,
});
if (condition === 'C') env.LP_NODE_PROFILE = String(SAMPLE_US);
const child = spawn(process.execPath, ['dev.mjs'], { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'], env });
let childErr = '';
child.stderr.on('data', (c) => {
  childErr += c;
});
const collectorLog = [];
let collector;

const cpuTimes = () =>
  cpus().reduce(
    (a, c) => {
      const t = c.times;
      a.idle += t.idle;
      a.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return a;
    },
    { idle: 0, total: 0 },
  );
const busyPct = (a, b) => Math.round((1 - (b.idle - a.idle) / Math.max(1, b.total - a.total)) * 1000) / 10;

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
  const origin = new URL(url).origin;
  const apiPort = Number(
    /const port = (\d+)/.exec(
      (await import('node:fs')).readFileSync(join(appRoot, 'server', 'index.ts'), 'utf8'),
    )[1],
  );
  say(`condition ${condition}: app ${appRoot} at ${url}, api port ${apiPort}`);
  daemon.correlator.addDevServer(origin, appRoot);

  collector = new BrowserCollector({
    url,
    headless: true,
    send: (m) => daemon.correlator.ingest('browser', m),
    log: (s) => collectorLog.push(s),
  });
  await collector.start();
  const page = collector.page;
  await page.waitForSelector('li:has-text("Coffee mug") button');
  const cdp2 = await page.context().newCDPSession(page);

  // ---- per-condition extras ----------------------------------------------------------------
  let extra = {};
  const resetExtra = () => {
    extra = { initiators: [], reads: [], hits: [] };
  };
  resetExtra();
  if (condition === 'B') {
    await cdp2.send('Debugger.enable');
    await cdp2.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
    await cdp2.send('Network.enable');
    cdp2.on('Network.requestWillBeSent', (e) => {
      if (e.request.url.includes('/api/orders'))
        extra.initiators.push({ t: performance.now(), initiator: e.initiator });
    });
  }
  if (condition === 'A') {
    await cdp2.send('Profiler.enable');
    await cdp2.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const take = async (name) => {
      const t0 = performance.now();
      const { result } = await cdp2.send('Profiler.takePreciseCoverage');
      extra.reads.push({
        name,
        ms: performance.now() - t0,
        coverage: result.filter((s) => s.url.startsWith(origin) && s.url.includes('/src/')),
      });
    };
    await page.route('**/api/orders', async (route, request) => {
      await take('request-sent');
      const response = await route.fetch({
        headers: { ...request.headers(), 'x-lightpath-trace': activeTrace },
      });
      await take('response-arrived');
      await route.fulfill({ response });
    });
  }
  if (condition === 'C') {
    await cdp2.send('Profiler.enable');
    await cdp2.send('Profiler.setSamplingInterval', { interval: SAMPLE_US });
  }
  const bpKeys = new Map(); // breakpointId -> {scriptId, offset}
  if (condition === 'E') {
    await cdp2.send('Debugger.enable');
    cdp2.on('Debugger.paused', (e) => {
      if (e.hitBreakpoints?.length) extra.hits.push({ t: performance.now(), ids: e.hitBreakpoints });
    });
  }

  const press = async (selector) => {
    const box = await page.locator(selector).first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await new Promise((r) => setTimeout(r, 80));
    await page.mouse.up();
  };
  const waitForTrace = async (label, since, needNode) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const t = [...traces.values()].find(
        (x) =>
          x.label === label &&
          x.startedAt >= since &&
          x.endedAt &&
          (!needNode || x.files.some((f) => f.collector === 'node')),
      );
      if (t) return t;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no ${label} trace`);
  };
  const nodeLog = async () =>
    gt ? (await fetch(`http://127.0.0.1:${apiPort}/__lp`)).json() : { order: [], profiles: [] };
  const pageLog = async () => (gt ? page.evaluate(() => globalThis.__lpOrder.splice(0)) : []);

  let lastNotice = '';
  for (let i = 0; i <= runs; i++) {
    const product = condition === 'P' && i >= 20 ? 'Desk lamp' : 'Coffee mug';
    const add0 = Date.now();
    await press(`li:has-text("${product}") button`);
    await waitForTrace('button: Add to cart', add0, false);
    if (condition === 'E' && bpKeys.size === 0) {
      // Breakpoints at every app function V8 reported so far (count 0 included), set once.
      const seen = new Set();
      for (const { agentId, message } of deltas) {
        if (agentId !== 'browser') continue;
        for (const s of message.coverage) {
          if (!s.url.startsWith(origin) || !s.url.includes('/src/') || s.url.includes('lp-log')) continue;
          for (const f of s.functions) {
            const k = `${s.scriptId}|${f.ranges[0].startOffset}`;
            if (seen.has(k) || f.ranges[0].startOffset === 0) continue;
            seen.add(k);
            const src = sources.get(scripts.get(`browser|${s.scriptId}`)?.hash) ?? '';
            const before = src.slice(0, f.ranges[0].startOffset).split('\n');
            try {
              const r = await cdp2.send('Debugger.setBreakpoint', {
                location: {
                  scriptId: s.scriptId,
                  lineNumber: before.length - 1,
                  columnNumber: before.at(-1).length,
                },
              });
              bpKeys.set(r.breakpointId, {
                scriptId: s.scriptId,
                offset: f.ranges[0].startOffset,
                actual: r.actualLocation,
              });
            } catch {}
          }
        }
      }
      say(`E: set ${bpKeys.size} breakpoints`);
    }
    await pageLog();
    await nodeLog();
    resetExtra();
    const deltaMark = deltas.length;
    const logMark = collectorLog.length;
    const cpu0 = cpuTimes();
    if (condition === 'C') await cdp2.send('Profiler.start');
    const t0 = Date.now();
    const p0 = performance.now();
    await press('button:has-text("Checkout")');
    await page.waitForFunction(
      (prev) => {
        const n = document.querySelector('.notice');
        return n && n.textContent !== prev && /Order #\d+ placed/.test(n.textContent);
      },
      lastNotice,
      { timeout: 10_000 },
    );
    const visibleMs = performance.now() - p0;
    lastNotice = await page.locator('.notice').textContent();
    const trace = await waitForTrace('button: Checkout', t0, true);
    const profile = condition === 'C' ? (await cdp2.send('Profiler.stop')).profile : undefined;
    const cpu1 = cpuTimes();
    const browserOrder = await pageLog();
    const node = await nodeLog();
    const pauseLine = collectorLog
      .slice(logMark)
      .find((l) => l.includes(trace.id) && l.startsWith('click on'));
    const pausedMs = pauseLine ? Number(/paused ([\d.]+)ms/.exec(pauseLine)?.[1]) : null;
    const runDeltas = deltas.slice(deltaMark).filter((d) => d.message.traceId === trace.id);
    const record = {
      condition,
      run: i,
      warmup: i === 0,
      product,
      busyPctDuringRun: busyPct(cpu0, cpu1),
      pausedMs,
      boundary: pauseLine?.includes('boundary release') ? 'release' : 'press',
      visibleMs,
      trace,
      deltas: runDeltas.map((d) => ({
        agentId: d.agentId === 'browser' ? 'browser' : 'node',
        startedAt: d.message.startedAt,
        endedAt: d.message.endedAt,
        request: d.message.request,
        coverage: d.message.coverage.filter((s) =>
          d.agentId === 'browser'
            ? s.url.startsWith(origin) && s.url.includes('/src/')
            : s.url.startsWith('file:'),
        ),
      })),
      groundTruth: { browser: browserOrder, node: node.order },
      handlerStacks: node.stacks,
      ...(condition === 'B' ? { initiators: extra.initiators } : {}),
      ...(condition === 'A' ? { reads: extra.reads } : {}),
      ...(condition === 'C' ? { profile, nodeProfiles: node.profiles } : {}),
      ...(condition === 'E' ? { hits: extra.hits } : {}),
    };
    appendFileSync(runFile, `${JSON.stringify(record)}\n`);
    say(
      `run ${i}${i === 0 ? ' (warm-up)' : ''}: trace ${trace.id}, paused ${pausedMs} ms, visible ${visibleMs.toFixed(1)} ms, ` +
        `request ${trace.requests.map((r) => `${r.method} ${r.path} ${r.status} ${r.durationMs} ms`).join('; ')}, ` +
        `gt ${browserOrder.length}+${node.order.length} calls, busy ${record.busyPctDuringRun}%`,
    );
  }

  // Scripts and sources once per condition, for analyze.mjs.
  const keep = [...scripts].filter(([k, s]) =>
    k.startsWith('browser|')
      ? s.url.startsWith(origin) && s.url.includes('/src/')
      : s.url.startsWith('file:'),
  );
  writeFileSync(
    join(out, `scripts-${condition}.json`),
    JSON.stringify({
      appRoot,
      origin,
      bpKeys: [...bpKeys],
      scripts: keep.map(([k, s]) => ({
        agent: k.startsWith('browser|') ? 'browser' : 'node',
        ...s,
        source: sources.get(s.hash),
      })),
    }),
  );
  say(`condition ${condition}: done, ${runs} timed runs after 1 warm-up`);
} catch (err) {
  say(`FAILED: ${err?.stack ?? err}\n${childErr}`);
  process.exitCode = 1;
} finally {
  await collector?.stop().catch(() => {});
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {
    // Already exited.
  }
  await daemon.close();
}
