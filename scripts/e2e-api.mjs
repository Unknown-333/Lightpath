// Backend-only end-to-end test (docs/ROADMAP.md, M2). Runs the real CLI as a user would,
// `lightpath dev --no-browser -- <command>`, posts one order, and reads the trace from the daemon
// over its client WebSocket, for each of these:
//
//   shop: strip       node server/index.ts         Express, Node's type stripping (no map needed)
//   shop: tsx         tsx server/index.ts          esbuild rewrites the code; lines from tsx's inline map
//   shop: tsx-watch   tsx watch server/index.ts    the same, through tsx's watcher process
//   shop: tsc         node dist/server/index.js    built by tsc; lines from external .map files
//   fastify           node fastify/server.ts       Fastify 5, type stripping
//   nest              node dist/nest/main.js       NestJS 12 (decorators), built by tsc with .map files
//   shop: config      lightpath dev --config ...   the command, browser: false, and ignore from a config file
//
// Type stripping keeps every offset, so a stripped run is the reference: runs that go through a
// source map must light exactly the same lines in the files they share with it.
//
// Usage: pnpm build && node scripts/e2e-api.mjs [run-name ...]
import { execFileSync, execSync, spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const shop = join(repo, 'examples', 'shop');
const backends = join(repo, 'examples', 'backends');
const cliBin = join(repo, 'packages', 'cli', 'dist', 'bin.js');
const { DaemonClient, DaemonDiscovery, DISCOVERY_FILE } = await import(
  new URL('../packages/protocol/dist/index.js', import.meta.url).href
);

/** A package's bin, resolved from `fromDir` like `npx` would. */
function binOf(fromDir, pkg, name) {
  const pkgPath = createRequire(join(fromDir, 'package.json')).resolve(`${pkg}/package.json`);
  const json = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return join(dirname(pkgPath), typeof json.bin === 'string' ? json.bin : json.bin[name]);
}
const tsxBin = binOf(shop, 'tsx', 'tsx');
const tscBin = binOf(repo, 'typescript', 'tsc');
const [major, minor] = process.versions.node.split('.').map(Number);
const strip = major === 22 && minor < 18 ? ['--experimental-strip-types'] : [];
const node = process.execPath;

const shopOrder = { lines: [{ productId: 'lamp', qty: 1 }] };
const backendOrder = { lines: [{ sku: 'lamp', qty: 1 }] };
const shopFiles = [
  'server/routes/orders.ts',
  'server/services/pricing.ts',
  'server/services/payment.ts',
  'server/db.ts',
];
const shopLines = {
  'server/routes/orders.ts': { dark: ["'Your cart is empty.'"], lit: ['saveOrder('] },
};
const checkoutLines = {
  'shared/checkout.ts': {
    dark: ["'Your cart is empty.'", 'Unknown product'],
    lit: ['subtotalCents += price'],
  },
};

/**
 * Each run: where to start it, the command, the body to POST, the route file the trace must contain,
 * other files it must contain, lines that must be dark or lit (found by text), and the run whose
 * lines it must match exactly.
 */
const RUNS = [
  {
    name: 'shop: strip',
    cwd: shop,
    command: [node, ...strip, 'server/index.ts'],
    order: shopOrder,
    files: shopFiles,
    lines: shopLines,
  },
  {
    name: 'shop: tsx',
    cwd: shop,
    command: [node, tsxBin, 'server/index.ts'],
    order: shopOrder,
    files: shopFiles,
    lines: shopLines,
    sameAs: 'shop: strip',
    skipsTsxCli: true,
  },
  {
    name: 'shop: tsx-watch',
    cwd: shop,
    command: [node, tsxBin, 'watch', 'server/index.ts'],
    order: shopOrder,
    files: shopFiles,
    lines: shopLines,
    sameAs: 'shop: strip',
    skipsTsxCli: true,
  },
  {
    name: 'shop: tsc',
    cwd: shop,
    build: () => tsc(shop, 'tsconfig.server.json', 'dist/server'),
    command: [node, 'dist/server/index.js'],
    order: shopOrder,
    files: shopFiles,
    lines: shopLines,
    sameAs: 'shop: strip',
    noDist: true,
  },
  {
    name: 'fastify',
    cwd: backends,
    command: [node, ...strip, 'fastify/server.ts'],
    order: backendOrder,
    files: ['fastify/server.ts', 'shared/checkout.ts'],
    lines: {
      ...checkoutLines,
      'fastify/server.ts': { dark: ['reply.code(result.status)'], lit: ['reply.code(201)'] },
    },
  },
  {
    name: 'nest',
    cwd: backends,
    build: () => tsc(backends, 'tsconfig.nest.json', 'dist'),
    command: [node, 'dist/nest/main.js'],
    order: backendOrder,
    files: ['nest/orders.controller.ts', 'nest/orders.service.ts', 'shared/checkout.ts'],
    lines: {
      ...checkoutLines,
      'nest/orders.controller.ts': { dark: ['throw new HttpException'], lit: ['return result.quote'] },
    },
    // Nest's own code runs from node_modules and is dropped; the shared checkout must match Fastify's.
    sameAs: 'fastify',
    noDist: true,
  },
  {
    // Everything comes from the config file: no `--` command and no `--no-browser` flag.
    name: 'shop: config',
    cwd: shop,
    config: {
      command: [node, ...strip, 'server/index.ts'].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '),
      browser: false,
      ignore: ['server/services/payment.ts'],
    },
    order: shopOrder,
    files: shopFiles.filter((f) => f !== 'server/services/payment.ts'),
    lines: shopLines,
    ignored: ['server/services/payment.ts'],
    sameAs: 'shop: strip',
  },
];

const CONFIG_NAME = 'lightpath.e2e.config.json';

function tsc(cwd, project, outDir) {
  rmSync(join(cwd, outDir), { recursive: true, force: true });
  execFileSync(node, [tscBin, '-p', project], { cwd, stdio: 'inherit' });
}

const API = 'http://127.0.0.1:3001';
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

/** Runs one app through the real CLI and returns its order trace and the CLI's output. */
async function traceOrder(run) {
  if (run.config) writeFileSync(join(run.cwd, CONFIG_NAME), JSON.stringify(run.config));
  const args = run.config
    ? ['dev', '--config', CONFIG_NAME, '--debug']
    : ['dev', '--no-browser', '--debug', '--', ...run.command];
  const cli = spawn(node, [cliBin, ...args], {
    cwd: run.cwd,
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
    await until(`${run.name}: the API to start`, () => {
      if (cli.exitCode !== null) throw new Error(`${run.name}: lightpath dev exited with ${cli.exitCode}`);
      return output.includes('listening on port');
    });
    const info = await until(`${run.name}: the discovery file`, () => {
      try {
        const file = readFileSync(join(run.cwd, DISCOVERY_FILE), 'utf8');
        const parsed = DaemonDiscovery.parse(JSON.parse(file));
        return parsed.pid === cli.pid ? parsed : undefined;
      } catch {
        return undefined;
      }
    });
    client = await DaemonClient.connect(info.port, info.token);

    const res = await fetch(`${API}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(run.order),
    });
    check(res.status === 201, `${run.name}: POST /api/orders answered 201 (got ${res.status})`);

    const route = run.files[0];
    const trace = await until(`${run.name}: a finished trace with ${route}`, async () => {
      for (const summary of await client.listTraces({ limit: 10 })) {
        const t = await client.getTrace(summary.id);
        if (t?.endedAt !== undefined && t.files.some((f) => f.path === route)) return t;
      }
      return undefined;
    });
    await sleep(300); // let the CLI print the trace
    return { trace, output };
  } catch (err) {
    console.log(output.slice(-3000));
    throw err;
  } finally {
    client?.close();
    // The tree may already be gone (the app crashed); that must not hide the real error.
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${cli.pid} /T /F`, { stdio: 'ignore' });
      else process.kill(-cli.pid, 'SIGTERM');
    } catch {}
    if (cli.exitCode === null && cli.signalCode === null) await exited;
    // A forced stop skips the daemon's cleanup; remove the discovery file it would have removed.
    rmSync(join(run.cwd, DISCOVERY_FILE), { force: true });
    if (run.config) rmSync(join(run.cwd, CONFIG_NAME), { force: true });
    await until(`${run.name}: port 3001 to be free`, () =>
      fetch(API).then(
        () => false,
        () => true,
      ),
    );
  }
}

const lineSet = (file) => file?.lines.map((l) => `${l.line}:${l.count}`).join(' ') ?? '(missing)';
/** 1-based line of the first line containing `text`, or 0. */
const lineOf = (cwd, path, text) =>
  readFileSync(join(cwd, path), 'utf8')
    .split('\n')
    .findIndex((l) => l.includes(text)) + 1;

const only = process.argv.slice(2);
const results = {};
try {
  for (const run of RUNS) {
    if (only.length > 0 && !only.includes(run.name)) continue;
    console.log(
      run.config
        ? `\n--- ${run.name}: lightpath dev --config ${JSON.stringify(run.config)}`
        : `\n--- ${run.name}: lightpath dev --no-browser -- ${run.command.slice(1).join(' ')}`,
    );
    run.build?.();
    const { trace, output } = await traceOrder(run);
    results[run.name] = trace;
    check(
      trace.requests.some((r) => r.method === 'POST' && r.path === '/api/orders' && r.status === 201),
      `${run.name}: the trace records POST /api/orders 201`,
    );
    check(
      trace.files.every((f) => f.collector === 'node'),
      `${run.name}: every file came from the Node agent`,
    );
    for (const path of run.files) {
      check(
        trace.files.some((f) => f.path === path),
        `${run.name}: the trace includes ${path}`,
      );
    }
    for (const path of run.ignored ?? []) {
      check(!trace.files.some((f) => f.path === path), `${run.name}: ${path} is left out (ignore)`);
      check(
        trace.dropped.some((d) => d.reason === 'ignored' && d.count > 0),
        `${run.name}: the trace counts it as ignored (${JSON.stringify(trace.dropped)})`,
      );
    }
    for (const [path, { dark, lit }] of Object.entries(run.lines)) {
      const file = trace.files.find((f) => f.path === path);
      for (const text of dark) {
        const n = lineOf(run.cwd, path, text);
        check(n > 0 && !file?.lines.some((l) => l.line === n), `${run.name}: ${path}:${n} (${text}) is dark`);
      }
      for (const text of lit) {
        const n = lineOf(run.cwd, path, text);
        check(
          n > 0 && Boolean(file?.lines.some((l) => l.line === n)),
          `${run.name}: ${path}:${n} (${text}) is lit`,
        );
      }
    }
    check(
      !trace.dropped.some((d) => d.reason === 'no-source' || d.reason === 'no-source-map'),
      `${run.name}: nothing dropped for a missing source or map (${JSON.stringify(trace.dropped)})`,
    );
    check(output.includes(run.files[0]), `${run.name}: the terminal printed ${run.files[0]}`);
    if (run.noDist) {
      // With the .map files read, every file shows as its TypeScript source, never as dist/*.js.
      check(
        !trace.files.some((f) => f.path.startsWith('dist/')),
        `${run.name}: no compiled dist/ file in the trace (${trace.files.map((f) => f.path).join(', ')})`,
      );
    }
    if (run.skipsTsxCli) {
      // The tsx CLI (and its watcher) must be skipped; only the process running the app reports.
      check(
        /skipped tool process: .*tsx[\\/]dist[\\/]cli\./.test(output),
        `${run.name}: the agent skipped tsx's own CLI process`,
      );
    }
  }

  // Source maps (tsx's inline ones, tsc's .map files) must give exactly the lines type stripping
  // gives, in every file both runs share.
  for (const run of RUNS) {
    const truth = results[run.sameAs];
    const mine = results[run.name];
    if (!run.sameAs || !truth || !mine) continue;
    const shared = mine.files.map((f) => f.path).filter((p) => truth.files.some((f) => f.path === p));
    check(shared.length > 0, `${run.name}: shares files with ${run.sameAs}`);
    for (const path of shared.sort()) {
      const a = lineSet(truth.files.find((f) => f.path === path));
      const b = lineSet(mine.files.find((f) => f.path === path));
      check(
        a === b,
        `${run.name}: ${path} lines match ${run.sameAs}${a === b ? '' : `\n  ${run.sameAs}: ${a}\n  ${run.name}: ${b}`}`,
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
