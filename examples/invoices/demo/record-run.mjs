// Records the README demo run (D-136): one real kiro-cli session fixing a planted bug in a copy of
// this app, with Lightpath's own browser filmed through a DevTools screencast.
//
// What it does, in order:
//   1. Copies examples/invoices to <out>/trial and plants the bug: the line in markPaid() that
//      clears the summary cache is removed, so Outstanding stays the same after "Mark as paid".
//   2. Runs `lightpath init --agent kiro` there, and writes a kiro-cli agent file whose Lightpath
//      server is this checkout's CLI (not npx), like the benchmark's `with` condition (D-130).
//   3. Starts the daemon, the app with the Node agent, and Lightpath's browser, headless, the way
//      `lightpath dev` does, and starts a screencast of that page. Nothing is captured from the
//      screen and no OS mouse or keyboard is used: the agent's run_action calls do the clicking.
//   4. Runs kiro-cli once with the user's bug report, saving each stream-json line with the time
//      it arrived, then stops everything and writes run.json (versions, model, credits, steps).
//
// Usage: pnpm build && node examples/invoices/demo/record-run.mjs --out <folder>
// kiro-cli: LP_KIRO_CLI=<path to kiro-cli> (default: kiro-cli on PATH).
// Then: node examples/invoices/demo/render-gif.mjs --run <folder>
import { execFileSync, execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const repo = join(app, '..', '..');
const dist = (pkg) => pathToFileURL(join(repo, 'packages', pkg, 'dist', 'index.js')).href;
const { startDaemon } = await import(dist('daemon'));
const { BrowserCollector } = await import(dist('browser'));
const { registerUrl } = await import(dist('node-agent'));
const { agentEnv, UrlWatcher } = await import(dist('cli'));
const bench = await import(pathToFileURL(join(repo, 'bench', 'agent-suite', 'lib', 'agent.mjs')).href);

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw new Error('--out <folder> is required');
const out = resolve(values.out);
const trial = join(out, 'trial');
if (existsSync(trial)) throw new Error(`${trial} exists; use a new --out folder`);

export const MODEL = 'claude-sonnet-5.5';
export const EFFORT = 'medium';
export const VIEWPORT = { width: 1100, height: 760 };
export const PROMPT = [
  'I click "Mark as paid" on the Kestrel Labs invoice. The row turns Paid, but Outstanding at the',
  'top stays at $42,485.50. Please fix it. The app is already running; use Lightpath to see what',
  'the click runs.',
].join(' ');
const KIRO = process.env.LP_KIRO_CLI ?? 'kiro-cli';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cpu = () => {
  if (process.platform !== 'win32') return null;
  const ps = "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue";
  return Number(
    Number(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })).toFixed(1),
  );
};

// 1. The trial copy, with the bug planted.
mkdirSync(out, { recursive: true });
cpSync(app, trial, {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|\.lightpath|demo)([\\/]|$)/.test(src.slice(app.length)),
});
// Its own node_modules: a link to the repo's would put React outside the folder Vite may serve.
// The trial is outside the workspace, so pnpm installs it on its own, from the local store.
// The app's tsconfig extends the repo's base config; the copy brings that file along.
cpSync(join(repo, 'tsconfig.base.json'), join(trial, 'tsconfig.base.json'));
const tsconfigPath = join(trial, 'tsconfig.json');
writeFileSync(
  tsconfigPath,
  readFileSync(tsconfigPath, 'utf8').replace('"../../tsconfig.base.json"', '"./tsconfig.base.json"'),
);
// esbuild (under Vite and tsx) needs its install script, as in the repo's pnpm-workspace.yaml.
writeFileSync(join(trial, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n');
execSync('corepack pnpm install --prefer-offline', { cwd: trial, stdio: 'ignore' });
rmSync(join(trial, 'pnpm-workspace.yaml'));
rmSync(join(trial, 'pnpm-lock.yaml'), { force: true });
const ledgerPath = join(trial, 'server', 'services', 'ledger.ts');
const FIX_LINE = '  summaryCache = null; // the totals changed\n';
const ledger = readFileSync(ledgerPath, 'utf8').replace(/\r\n/g, '\n');
if (!ledger.includes(FIX_LINE)) throw new Error('the line to remove is not in ledger.ts');
writeFileSync(ledgerPath, ledger.replace(FIX_LINE, ''));
writeFileSync(join(out, 'planted.ts'), readFileSync(ledgerPath, 'utf8'));

// 2. Lightpath set up for Kiro, as a user would, then the agent file kiro-cli runs with.
const cliBin = join(repo, 'packages', 'cli', 'dist', 'bin.js');
const init = execFileSync(process.execPath, [cliBin, 'init', '--agent', 'kiro'], {
  cwd: trial,
  encoding: 'utf8',
});
writeFileSync(join(out, 'init.out'), init);
const config = bench.agentConfig('with', {
  lightpathServer: { command: process.execPath, args: [cliBin, 'mcp'] },
});
config.name = 'demo';
mkdirSync(join(trial, '.kiro', 'agents'), { recursive: true });
writeFileSync(join(trial, '.kiro', 'agents', 'demo.json'), `${JSON.stringify(config, null, 2)}\n`);

// 3. Lightpath and the app, as `lightpath dev` runs them.
const daemon = await startDaemon({ workspaceRoots: [trial] });
const child = spawn(process.execPath, ['dev.mjs'], {
  cwd: trial,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: agentEnv(process.env, { daemonUrl: daemon.url, token: daemon.token, roots: [trial], registerUrl }),
});
let childOut = '';
child.stderr.on('data', (c) => {
  childOut += c;
});

// A visible pointer: screencasts don't draw the mouse. Injected with evaluate, so it has no script
// URL and the collector leaves it out of traces, like any script that isn't the app's.
const CURSOR = `(() => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
    'background:rgba(79,70,229,.35);border:2px solid #4f46e5;pointer-events:none;z-index:2147483647;' +
    'transition:transform .12s;transform:translate(-100px,-100px)';
  let x = -100, y = -100, s = 1;
  const draw = () => { c.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; };
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
  addEventListener('pointerdown', (e) => { x = e.clientX; y = e.clientY; s = 0.7; draw(); }, true);
  addEventListener('pointerup', () => { s = 1; draw(); }, true);
  document.body.appendChild(c);
})()`;

const framesDir = join(out, 'frames');
mkdirSync(framesDir, { recursive: true });
const frames = [];
const lines = [];
let collector;
let kiro;
let failed = false;
const run = { model: MODEL, effort: EFFORT, prompt: PROMPT, viewport: VIEWPORT };
try {
  const url = await new Promise((res, rej) => {
    const watcher = new UrlWatcher();
    const timer = setTimeout(() => rej(new Error(`dev server didn't start:\n${childOut}`)), 30_000);
    child.stdout.on('data', (c) => {
      childOut += c;
      const found = watcher.push(String(c));
      if (found) {
        clearTimeout(timer);
        res(found);
      }
    });
  });
  daemon.correlator.addDevServer(new URL(url).origin, trial);
  // Vite prints its URL before tsx has the API up; open the page once both answer.
  const apiDeadline = Date.now() + 30_000;
  while (
    !(await fetch('http://127.0.0.1:3002/api/invoices').then(
      (r) => r.ok,
      () => false,
    ))
  ) {
    if (Date.now() > apiDeadline) throw new Error(`API didn't start:\n${childOut}`);
    await sleep(250);
  }
  collector = new BrowserCollector({
    url,
    headless: true,
    send: (m) => daemon.correlator.ingest('browser', m),
  });
  await collector.start();
  daemon.setActionRunner((request) => collector.runAction(request));
  const page = collector.page;
  await page.setViewportSize(VIEWPORT);
  const consoleLog = [];
  page.on('console', (m) => consoleLog.push(`${m.type()}: ${m.text()}`));
  try {
    await page.waitForSelector('text=Kestrel Labs');
  } catch (e) {
    await page.reload();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(out, 'no-app.png') });
    writeFileSync(join(out, 'no-app.log'), `${consoleLog.join('\n')}\n${childOut}`);
    throw e;
  }
  await page.evaluate(CURSOR);

  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    const file = `f${String(frames.length).padStart(4, '0')}.jpg`;
    writeFileSync(join(framesDir, file), Buffer.from(f.data, 'base64'));
    frames.push({ at: Date.now(), file });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, ...{ maxWidth: VIEWPORT.width } });
  await sleep(1500);

  // 4. The agent run.
  run.kiroCli = execFileSync(KIRO, ['--version'], { encoding: 'utf8' }).trim();
  run.cpuStart = cpu();
  const args = [
    'chat',
    '--no-interactive',
    '--trust-all-tools',
    '--trust-workspace',
    '--require-mcp-startup',
    '--agent',
    'demo',
    '--model',
    MODEL,
    '--effort',
    EFFORT,
    '--output-format',
    'stream-json',
    '--wrap',
    'never',
    bench.buildPrompt(PROMPT),
  ];
  run.args = args.slice(0, -1);
  run.startedAt = Date.now();
  kiro = spawn(KIRO, args, { cwd: trial, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  let err = '';
  kiro.stdout.on('data', (c) => {
    buf += c;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) lines.push({ at: Date.now(), line });
      nl = buf.indexOf('\n');
    }
  });
  kiro.stderr.on('data', (c) => {
    err += c;
  });
  run.exitCode = await new Promise((res) => {
    const timer = setTimeout(() => {
      run.timedOut = true;
      try {
        execSync(`taskkill /pid ${kiro.pid} /T /F`, { stdio: 'ignore' });
      } catch {}
    }, 10 * 60_000);
    kiro.on('exit', (code) => {
      clearTimeout(timer);
      res(code);
    });
  });
  if (buf.trim()) lines.push({ at: Date.now(), line: buf.trim() });
  run.endedAt = Date.now();
  run.cpuEnd = cpu();
  writeFileSync(join(out, 'kiro-cli.stderr.log'), err);
  await sleep(2500); // the page settles after the last action
  await cdp.send('Page.stopScreencast').catch(() => {});
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await collector?.stop().catch(() => {});
  for (const p of [kiro, child]) {
    if (!p?.pid) continue;
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
      else p.kill('SIGTERM');
    } catch {}
  }
  await daemon.close();
}

writeFileSync(join(out, 'transcript.jsonl'), lines.map((l) => `${l.line}\n`).join(''));
writeFileSync(join(out, 'timing.json'), `${JSON.stringify(lines.map((l) => l.at))}\n`);
writeFileSync(join(out, 'frames.json'), `${JSON.stringify(frames)}\n`);
writeFileSync(join(out, 'fixed.ts'), readFileSync(ledgerPath, 'utf8'));
const events = lines.map((l) => {
  try {
    return JSON.parse(l.line);
  } catch {
    return { unparsed: l.line };
  }
});
const parsed = bench.parseTranscript(events);
const tokens = bench.estimateTokens(events, bench.buildPrompt(PROMPT));
Object.assign(run, {
  steps: parsed.steps,
  credits: parsed.credits,
  tokensEst: tokens.tokensEst,
  tokensMethod: tokens.tokensMethod,
  status: parsed.status,
  wallMs: run.endedAt - run.startedAt,
  frames: frames.length,
  tools: parsed.toolCalls.map((c) => c.title),
  fixLineBack: readFileSync(ledgerPath, 'utf8').includes('summaryCache = null'),
});
writeFileSync(join(out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
console.log(JSON.stringify({ ...run, prompt: undefined, args: undefined }, null, 2));
process.exit(failed ? 1 : 0);
