// Backend-only end-to-end test (docs/ROADMAP.md, M2): runs the real CLI as a user would,
// `lightpath dev --no-browser -- <command>`, with the shop's Express API started three ways:
//
//   strip      node server/index.ts           Node's type stripping (positions unchanged, no map)
//   tsx        tsx server/index.ts            esbuild rewrites the code; lines come from tsx's map
//   tsx-watch  tsx watch server/index.ts      the same, through tsx's watcher process
//   tsc        node dist/server/index.js      built by tsc first; lines come from external .map files
//
// For each, it POSTs one order and reads the trace from the daemon over its client WebSocket.
// Type stripping keeps every offset, so its lines are the ground truth: the other runs must light
// exactly the same lines in every file.
//
// Usage: pnpm build && node scripts/e2e-api.mjs
import { execFileSync, execSync, spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const shop = join(repo, 'examples', 'shop');
const cliBin = join(repo, 'packages', 'cli', 'dist', 'bin.js');
const { DaemonClient, DaemonDiscovery, DISCOVERY_FILE } = await import(
  new URL('../packages/protocol/dist/index.js', import.meta.url).href
);

// tsx's bin field, resolved from the shop like `npx tsx` would.
const tsxPkgPath = createRequire(join(shop, 'package.json')).resolve('tsx/package.json');
const tsxPkg = JSON.parse(readFileSync(tsxPkgPath, 'utf8'));
const tsxBin = join(dirname(tsxPkgPath), typeof tsxPkg.bin === 'string' ? tsxPkg.bin : tsxPkg.bin.tsx);
const [major, minor] = process.versions.node.split('.').map(Number);
const stripFlag = major === 22 && minor < 18 ? ['--experimental-strip-types'] : [];

const RUNS = {
  strip: [process.execPath, ...stripFlag, 'server/index.ts'],
  tsx: [process.execPath, tsxBin, 'server/index.ts'],
  'tsx-watch': [process.execPath, tsxBin, 'watch', 'server/index.ts'],
  // Built by tsc first (below): JavaScript in dist/ with an external .map file per script.
  tsc: [process.execPath, 'dist/server/index.js'],
};

// tsc, resolved from the repo root like `pnpm exec tsc`.
const tsPkgPath = createRequire(join(repo, 'package.json')).resolve('typescript/package.json');
const tsPkg = JSON.parse(readFileSync(tsPkgPath, 'utf8'));
const tscBin = join(dirname(tsPkgPath), typeof tsPkg.bin === 'string' ? tsPkg.bin : tsPkg.bin.tsc);
rmSync(join(shop, 'dist', 'server'), { recursive: true, force: true });
execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.server.json'], { cwd: shop, stdio: 'inherit' });
const API = 'http://127.0.0.1:3001';
const ROUTE = 'server/routes/orders.ts';

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Runs one variant through the real CLI and returns its order trace and the CLI's output. */
async function traceOrder(name, command) {
  const cli = spawn(process.execPath, [cliBin, 'dev', '--no-browser', '--debug', '--', ...command], {
    cwd: shop,
    stdio: ['ignore', 'pipe', 'pipe'],
    // On POSIX, a process group lets us stop the CLI, tsx, and the server together.
    detached: process.platform !== 'win32',
  });
  let output = '';
  cli.stdout.on('data', (c) => {
    output += c;
  });
  cli.stderr.on('data', (c) => {
    output += c;
  });
  const exited = new Promise((r) => cli.once('exit', r));
  let client;
  try {
    await until(`${name}: the API to start`, () => output.includes('listening on port'));
    const info = await until(`${name}: the discovery file`, () => {
      try {
        const parsed = DaemonDiscovery.parse(JSON.parse(readFileSync(join(shop, DISCOVERY_FILE), 'utf8')));
        return parsed.pid === cli.pid ? parsed : undefined;
      } catch {
        return undefined;
      }
    });
    client = await DaemonClient.connect(info.port, info.token);

    const res = await fetch(`${API}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines: [{ productId: 'lamp', qty: 1 }] }),
    });
    check(res.status === 201, `${name}: POST /api/orders answered 201 (got ${res.status})`);

    const trace = await until(`${name}: a finished trace with ${ROUTE}`, async () => {
      for (const summary of await client.listTraces({ limit: 10 })) {
        const t = await client.getTrace(summary.id);
        if (t?.endedAt !== undefined && t.files.some((f) => f.path === ROUTE)) return t;
      }
      return undefined;
    });
    await sleep(300); // let the CLI print the trace
    return { trace, output };
  } finally {
    client?.close();
    if (process.platform === 'win32') execSync(`taskkill /pid ${cli.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-cli.pid, 'SIGTERM');
    await exited;
    // A forced stop skips the daemon's cleanup; remove the discovery file it would have removed.
    rmSync(join(shop, DISCOVERY_FILE), { force: true });
    await until(`${name}: port 3001 to be free`, () =>
      fetch(API).then(
        () => false,
        () => true,
      ),
    );
  }
}

const lineSet = (file) => file?.lines.map((l) => `${l.line}:${l.count}`).join(' ') ?? '(missing)';
const ordersSrc = readFileSync(join(shop, ROUTE), 'utf8').split('\n');
const emptyLine = ordersSrc.findIndex((l) => l.includes("'Your cart is empty.'")) + 1;
const saveLine = ordersSrc.findIndex((l) => l.includes('saveOrder(')) + 1;

const results = {};
try {
  for (const [name, command] of Object.entries(RUNS)) {
    console.log(`\n--- ${name}: lightpath dev --no-browser -- ${command.slice(1).join(' ')}`);
    const { trace, output } = await traceOrder(name, command);
    results[name] = trace;
    const route = trace.files.find((f) => f.path === ROUTE);
    check(
      trace.requests.some((r) => r.method === 'POST' && r.path === '/api/orders' && r.status === 201),
      `${name}: the trace records POST /api/orders 201`,
    );
    check(
      trace.files.every((f) => f.collector === 'node'),
      `${name}: every file came from the Node agent`,
    );
    for (const path of ['server/services/pricing.ts', 'server/services/payment.ts', 'server/db.ts']) {
      check(
        trace.files.some((f) => f.path === path),
        `${name}: the trace includes ${path}`,
      );
    }
    check(
      !route?.lines.some((l) => l.line === emptyLine),
      `${name}: ${ROUTE} line ${emptyLine} (empty cart) is dark`,
    );
    check(
      Boolean(route?.lines.some((l) => l.line === saveLine)),
      `${name}: ${ROUTE} line ${saveLine} is lit`,
    );
    check(
      !trace.dropped.some((d) => d.reason === 'no-source' || d.reason === 'no-source-map'),
      `${name}: nothing dropped for a missing source or map (${JSON.stringify(trace.dropped)})`,
    );
    check(output.includes(ROUTE), `${name}: the terminal printed ${ROUTE}`);
    if (name === 'tsc') {
      // With the .map files read, every file shows as its TypeScript source, never as dist/*.js.
      check(
        !trace.files.some((f) => f.path.startsWith('dist/')),
        `tsc: no compiled dist/ file in the trace (${trace.files.map((f) => f.path).join(', ')})`,
      );
    }
    if (name.startsWith('tsx')) {
      // The tsx CLI (and its watcher) must be skipped; only the process running the app reports.
      check(
        /skipped tool process: .*tsx[\\/]dist[\\/]cli\./.test(output),
        `${name}: the agent skipped tsx's own CLI process`,
      );
    }
  }

  // Source maps (tsx's inline ones, tsc's .map files) must give exactly the lines type stripping
  // gives, in every file.
  const truth = results.strip;
  for (const name of ['tsx', 'tsx-watch', 'tsc']) {
    const paths = [...new Set([...truth.files, ...results[name].files].map((f) => f.path))].sort();
    for (const path of paths) {
      const a = lineSet(truth.files.find((f) => f.path === path));
      const b = lineSet(results[name].files.find((f) => f.path === path));
      check(
        a === b,
        `${name}: ${path} lines match type stripping${a === b ? '' : `\n  strip ${a}\n  ${name} ${b}`}`,
      );
    }
  }
} catch (err) {
  failures.push(String(err?.stack ?? err));
  console.error(err);
}

if (failures.length === 0) console.log('\nAPI E2E PASSED');
else console.log(`\nAPI E2E FAILED (${failures.length})\n${failures.map((f) => `- ${f}`).join('\n')}`);
process.exit(failures.length === 0 ? 0 : 1);
