// First-five-minutes run (Phase B): what a developer does with only the README, timed per step.
//
//   install      npx <spec> --version      (npx downloads the CLI; the README has no other install step)
//   init         npx <spec> init --agent <agent>
//   doctor       npx <spec> doctor
//   first trace  a script acting as the agent: it starts the server the agent config names, exactly
//                as written there, and calls tools/list, then run_action, over MCP stdio
//
// The "agent" is this script, not a model: it sends fixed JSON-RPC messages. Nothing here needs a
// package, so it runs on a machine that has only Node and the published CLI.
//
// Usage:
//   node scripts/first-run.mjs --app <dir> [--copy <src>] [--install "npm install"]
//     [--spec @lightpath-dev/cli@latest | --pack] [--agent claude-code] [--cold]
//     --target 'button "Mark as paid"' [--within "Kestrel Labs"] [--fill '[{...}]']
//     [--ports 3002,5174] [--log <file.json>] [--space]
//
// --copy copies <src> to --app first (no node_modules, no .lightpath). --cold gives npm a fresh,
// empty cache in the temp folder, so the CLI and the app's packages download as on a new machine.
// --pack tests this checkout instead of npm (CI on a pull request): it packs every published
// package here (run `pnpm build` first), installs the tarballs in the app without saving them, and
// uses @lightpath-dev/cli@<this version>, which npx then finds in the app instead of downloading.

import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const app = resolve(opt('app') ?? fail('--app <dir> is required'));
const repo = join(import.meta.dirname, '..');
const pack = flag('pack');
const cliVersion = JSON.parse(readFileSync(join(repo, 'packages', 'cli', 'package.json'), 'utf8')).version;
const spec = pack ? `@lightpath-dev/cli@${cliVersion}` : opt('spec', '@lightpath-dev/cli@latest');
const agent = opt('agent', 'claude-code');
const target = opt('target') ?? fail('--target is required');
const within = opt('within');
const fill = opt('fill') ? JSON.parse(opt('fill')) : undefined;
const ports = (opt('ports') ?? '').split(',').filter(Boolean).map(Number);
const logFile = opt('log');
const traceTimeoutMs = Number(opt('trace-timeout', '240000'));

const CONFIG = {
  'claude-code': { file: '.mcp.json', key: 'mcpServers' },
  cursor: { file: '.cursor/mcp.json', key: 'mcpServers' },
  vscode: { file: '.vscode/mcp.json', key: 'servers' },
  kiro: { file: '.kiro/settings/mcp.json', key: 'mcpServers' },
}[agent];
if (!CONFIG) fail(`unknown --agent ${agent}`);

function fail(message) {
  console.error(`first-run: ${message}`);
  process.exit(2);
}

const env = { ...process.env };
if (flag('cold')) {
  // --space puts a space in the cache path, like a home folder "C:\Users\Jane Doe".
  env.npm_config_cache = mkdtempSync(join(tmpdir(), flag('space') ? 'lp npm cache ' : 'lp-npm-cache-'));
  console.log(`cold start: empty npm cache ${env.npm_config_cache}`);
}

const result = {
  date: new Date().toISOString(),
  os: `${process.platform} ${process.arch}`,
  node: process.version,
  spec,
  packed: pack,
  agent,
  app,
  agentIsAScript: true,
  steps: [],
};
const t0 = Date.now();
const secs = (ms) => Math.round(ms / 100) / 10;

/** One shell command, as a user types it in a terminal in the app folder. */
function step(name, command) {
  console.log(`\n=== STEP ${name}: ${command}`);
  const start = Date.now();
  const r = spawnSync(command, { cwd: app, env, shell: true, encoding: 'utf8', timeout: 900_000 });
  const s = secs(Date.now() - start);
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(output);
  console.log(`=== STEP ${name} took ${s} s, exit ${r.status ?? r.signal ?? r.error?.message}`);
  result.steps.push({ name, command, seconds: s, exit: r.status, output: output.slice(-4000) });
  return r.status === 0;
}

if (opt('copy')) {
  const src = resolve(opt('copy'));
  mkdirSync(app, { recursive: true });
  cpSync(src, app, {
    recursive: true,
    filter: (p) => !/[\\/](node_modules|\.lightpath)([\\/]|$)/.test(p.slice(src.length)),
  });
  console.log(`copied ${src} to ${app}`);
}
if (!existsSync(join(app, 'package.json'))) fail(`no package.json in ${app}`);

let ok = true;
if (opt('install')) ok = step('app install (the app, not Lightpath)', opt('install')) && ok;
if (pack) {
  const dir = mkdtempSync(join(tmpdir(), 'lp-packed-'));
  for (const name of readdirSync(join(repo, 'packages'))) {
    const pkg = JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    const r = spawnSync(`pnpm pack --pack-destination "${dir}"`, {
      cwd: join(repo, 'packages', name),
      shell: true,
      encoding: 'utf8',
    });
    if (r.status !== 0) fail(`pnpm pack failed in packages/${name}: ${r.stderr}`);
  }
  const tgz = readdirSync(dir).map((f) => `"${join(dir, f)}"`);
  console.log(`packed this checkout: ${readdirSync(dir).join(', ')}`);
  ok =
    step(
      'install the packed packages (pull request only)',
      `npm install --no-save --no-audit --no-fund ${tgz.join(' ')}`,
    ) && ok;
}
ok = step('install', `npx ${spec} --version`) && ok;
ok = step('init', `npx ${spec} init --agent ${agent}`) && ok;
// doctor exits 1 on any failed check; that is a finding, and the trace step still runs.
step('doctor', `npx ${spec} doctor`);

const trace = await firstTrace();
result.steps.push(trace);
ok = ok && trace.ok;

if (ports.length > 0) {
  let busy = ports;
  // The server stops its tree as it exits; give the OS up to 10 s to release the ports.
  for (let k = 0; k < 20 && busy.length > 0; k++) {
    if (k > 0) await new Promise((r) => setTimeout(r, 500));
    const still = [];
    for (const port of busy) if (await listening(port)) still.push(port);
    busy = still;
  }
  result.portsLeftOpen = busy;
  console.log(
    busy.length === 0
      ? `ports ${ports.join(', ')} free after the agent closed`
      : `STILL LISTENING: ${busy.join(', ')}`,
  );
  ok = ok && busy.length === 0;
}

result.totalSeconds = secs(Date.now() - t0);
result.ok = ok;
console.log('\n=== TIMINGS (seconds)');
for (const s of result.steps)
  console.log(`${String(s.seconds).padStart(7)}  ${s.name}${s.exit === 0 || s.ok ? '' : '  (FAILED)'}`);
console.log(`${String(result.totalSeconds).padStart(7)}  total`);
if (logFile) writeFileSync(logFile, `${JSON.stringify(result, null, 2)}\n`);
process.exit(ok ? 0 : 1);

/** The agent's side: start the configured server, initialize, tools/list, run_action. */
async function firstTrace() {
  const name = 'first trace (agent = this script, over MCP stdio)';
  const out = { name, seconds: 0, ok: false };
  const configPath = join(app, CONFIG.file);
  const config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  const entry = config[CONFIG.key]?.lightpath;
  if (!entry) {
    out.output = `no "lightpath" entry under "${CONFIG.key}" in ${CONFIG.file}`;
    console.log(out.output);
    return out;
  }
  out.command = [entry.command, ...(entry.args ?? [])].join(' ');
  console.log(`\n=== STEP ${name}: ${out.command}`);
  const start = Date.now();
  // Started without a shell, the way MCP clients start a stdio server.
  const child = spawn(entry.command, entry.args ?? [], { cwd: app, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  let id = 0;
  const rpc = (method, params, timeoutMs) =>
    new Promise((res, rej) => {
      const n = ++id;
      const timer = setTimeout(
        () => rej(new Error(`${method}: no answer in ${timeoutMs / 1000} s`)),
        timeoutMs,
      );
      pending.set(n, (m) => {
        clearTimeout(timer);
        res(m);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    });
  try {
    await rpc(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'first-run-script', version: '0' },
      },
      120_000,
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const list = await rpc('tools/list', {}, 30_000);
    const tools = (list.result?.tools ?? []).map((t) => t.name);
    out.toolsSeconds = secs(Date.now() - start);
    console.log(`tools/list after ${out.toolsSeconds} s: ${tools.join(', ')}`);
    const args = { target, ...(within ? { within } : {}), ...(fill ? { fill } : {}) };
    const callStart = Date.now();
    const call = await rpc('tools/call', { name: 'run_action', arguments: args }, traceTimeoutMs);
    out.runActionSeconds = secs(Date.now() - callStart);
    const text = call.result?.content?.[0]?.text ?? JSON.stringify(call.error ?? call);
    console.log(
      `run_action(${JSON.stringify({ ...args, fill: fill ? '[values hidden]' : undefined })}) after ${out.runActionSeconds} s →\n${text}`,
    );
    out.answer = text.slice(0, 6000);
    out.ok = call.result?.isError !== true && /^Trace t_[a-z0-9]{12}:/m.test(text);
  } catch (err) {
    out.output = String(err?.message ?? err);
    console.log(`first trace failed: ${out.output}`);
  }
  out.seconds = secs(Date.now() - start);
  // The agent closes: stdin ends, and the server must stop itself and what it started.
  child.stdin.end();
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 20_000))]);
  out.serverExit = code;
  if (code === 'timeout') {
    console.log('the MCP server did not exit 20 s after stdin closed; stopping it');
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGKILL');
    out.ok = false;
  }
  if (stderr.trim()) console.log(`server stderr:\n${stderr.trim().slice(-3000)}`);
  out.stderr = stderr.slice(-3000);
  const devLog = join(app, '.lightpath', 'dev.log');
  if (existsSync(devLog)) {
    out.devLog = readFileSync(devLog, 'utf8').slice(-4000);
    if (!out.ok) console.log(`.lightpath/dev.log:\n${out.devLog}`);
  }
  console.log(`=== STEP ${name} took ${out.seconds} s, ${out.ok ? 'trace returned' : 'NO TRACE'}`);
  return out;
}

function listening(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: 1000 });
    const finish = (up) => {
      socket.destroy();
      done(up);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
