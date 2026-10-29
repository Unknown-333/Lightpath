// Benchmark: what does Lightpath cost a Node backend per request? (docs/ROADMAP.md, M2)
//
// Generates an HTTP app with N compiled functions (all called once at startup, so V8 has compiled
// them), then sends sequential requests to it twice: once plain, once with the Lightpath agent
// reporting to a real daemon. Each request calls 50 app functions and does about 1 ms of
// arithmetic, so both costs show up:
//   - the two coverage reads per request (their cost grows with all compiled functions), and
//   - precise coverage itself, which stops V8 from optimizing code that counts executions.
//
// Usage: pnpm build && node bench/node-requests.mjs [--sizes 1000,10000,50000] [--requests 300]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const dist = (pkg) => new URL(`../packages/${pkg}/dist/index.js`, import.meta.url).href;
const { startDaemon } = await import(dist('daemon'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv } = await import(dist('cli'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SIZES = arg('sizes', '1000,10000,50000').split(',').map(Number);
const REQUESTS = Number(arg('requests', '300'));
const WARMUP = 30;
const FUNCTIONS_PER_MODULE = 100;
const PORT = 3099;

/** Writes an app with `total` functions in modules of 100 and returns its folder. */
function generateApp(total) {
  const dir = mkdtempSync(join(os.tmpdir(), `lightpath-bench-${total}-`));
  const modules = Math.max(1, Math.ceil(total / FUNCTIONS_PER_MODULE));
  for (let m = 0; m < modules; m++) {
    const fns = [];
    for (let f = 0; f < FUNCTIONS_PER_MODULE; f++) {
      fns.push(`export function f${f}(x) {\n  if (x < 0) return -x;\n  return x * ${f + 1} + ${m};\n}`);
    }
    const warm = Array.from({ length: FUNCTIONS_PER_MODULE }, (_, f) => `f${f}(${f})`).join(' + ');
    writeFileSync(
      join(dir, `m${m}.mjs`),
      `${fns.join('\n')}\nexport function warm() {\n  return ${warm};\n}\n`,
    );
  }
  writeFileSync(
    join(dir, 'server.mjs'),
    `import http from 'node:http';
const mods = await Promise.all(Array.from({ length: ${modules} }, (_, i) => import('./m' + i + '.mjs')));
for (const m of mods) m.warm();
function work(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.sqrt(i) % 7;
  return s;
}
http
  .createServer((req, res) => {
    let s = 0;
    for (let k = 0; k < 50; k++) s += mods[k % mods.length]['f' + (k % ${FUNCTIONS_PER_MODULE})](k);
    s += work(300000);
    res.end(String(s));
  })
  .listen(${PORT}, '127.0.0.1', () => console.log('bench app listening'));
`,
  );
  return dir;
}

/** Starts the app, sends warmup + timed requests, and returns latencies and the app's stderr. */
async function measure(dir, env) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => {
    out += c;
  });
  child.stderr.on('data', (c) => {
    err += c;
  });
  const started = performance.now();
  while (!out.includes('listening')) {
    if (child.exitCode !== null) throw new Error(`bench app exited: ${err}`);
    if (performance.now() - started > 60_000) throw new Error('bench app did not start in 60 s');
    await new Promise((r) => setTimeout(r, 20));
  }
  const startupMs = performance.now() - started;
  const latencies = [];
  for (let i = 0; i < WARMUP + REQUESTS; i++) {
    const t = performance.now();
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    await res.text();
    if (i >= WARMUP) latencies.push(performance.now() - t);
  }
  child.kill();
  await new Promise((r) => child.once('exit', r));
  return { latencies, stderr: err, startupMs };
}

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
};
const ms = (v) => v.toFixed(2);

const daemonRoot = mkdtempSync(join(os.tmpdir(), 'lightpath-bench-root-'));
mkdirSync(daemonRoot, { recursive: true });
const rows = [];
for (const size of SIZES) {
  const dir = generateApp(size);
  const daemon = await startDaemon({ workspaceRoots: [dir], writeDiscoveryFile: false });
  try {
    const plain = await measure(dir, { ...process.env, NODE_OPTIONS: '' });
    const env = agentEnv(process.env, {
      daemonUrl: daemon.url,
      token: daemon.token,
      roots: [dir],
      registerUrl,
    });
    const traced = await measure(dir, { ...env, LIGHTPATH_DEBUG: '1' });
    const takes = [...traced.stderr.matchAll(/take ([\d.]+) ms, (\d+) functions in delta/g)].map((m) => ({
      ms: Number(m[1]),
      functions: Number(m[2]),
    }));
    // The first take returns everything that ran since startup: about the whole app.
    const first = takes[0];
    const steady = takes.slice(1 + 2 * WARMUP).map((t) => t.ms);
    rows.push({
      size,
      firstTakeFunctions: first?.functions ?? 0,
      firstTakeMs: first?.ms ?? Number.NaN,
      takeP50: pct(steady, 50),
      takeP99: pct(steady, 99),
      plainP50: pct(plain.latencies, 50),
      plainP99: pct(plain.latencies, 99),
      tracedP50: pct(traced.latencies, 50),
      tracedP99: pct(traced.latencies, 99),
      plainStartup: plain.startupMs,
      tracedStartup: traced.startupMs,
    });
    console.error(`size ${size}: done (${takes.length} takes)`);
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
rmSync(daemonRoot, { recursive: true, force: true });

const cpu = os.cpus()[0]?.model.trim() ?? 'unknown CPU';
console.log(
  `\nNode ${process.version}, ${os.type()} ${os.release()}, ${cpu}, ${REQUESTS} requests after ${WARMUP} warmup\n`,
);
console.log(
  '| App functions | Functions in first read | Read: first | Read per request: p50 / p99 | Latency without Lightpath: p50 / p99 | Latency with Lightpath: p50 / p99 | Startup without / with |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    `| ${r.size} | ${r.firstTakeFunctions} | ${ms(r.firstTakeMs)} ms | ${ms(r.takeP50)} / ${ms(r.takeP99)} ms | ${ms(r.plainP50)} / ${ms(r.plainP99)} ms | ${ms(r.tracedP50)} / ${ms(r.tracedP99)} ms | ${Math.round(r.plainStartup)} / ${Math.round(r.tracedStartup)} ms |`,
  );
}
