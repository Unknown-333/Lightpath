// Suite v2's small app: examples/invoices from this repo, as a standalone copy outside the repo
// with no .git (SPEC.md), its own ports, and the same trial, diff and check helpers as tududi.mjs.
import { spawn } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CACHE_DIR,
  isWindows,
  killTree,
  listeners,
  npm,
  processesMentioning,
  REPO_DIR,
  run,
  sha256,
  sha256File,
  sleep,
  TRIALS_ROOT,
  waitForHttp,
} from '../../agent-suite/lib/common.mjs';

const SRC = join(REPO_DIR, 'examples', 'invoices');
export const APP = {
  name: 'invoices',
  commit: run('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR }).stdout.trim(),
};
export const API_PORT = 3612;
export const WEB_PORT = 5612;
export const PORTS = [API_PORT, WEB_PORT];
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
// The demo/ folder records the README GIF; it isn't part of the app.
const SKIP = new Set(['node_modules', 'dist', '.lightpath', 'demo']);
const NOT_SOURCE = new Set(['node_modules', '.kiro', '.git', 'dist', '.lightpath']);
const TEMPLATE_VERSION = 1;

function appFiles(dir = SRC) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...appFiles(path));
    else files.push(path);
  }
  return files.sort();
}

function readJsonc(path) {
  const text = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return JSON.parse(text);
}

function standaloneTsconfig() {
  const base = readJsonc(join(REPO_DIR, 'tsconfig.base.json'));
  const own = readJsonc(join(SRC, 'tsconfig.json'));
  const { extends: _e, ...rest } = own;
  const { $schema: _s, ...baseRest } = base;
  return { ...rest, compilerOptions: { ...baseRest.compilerOptions, ...own.compilerOptions } };
}

function standalonePackageJson() {
  const pkg = JSON.parse(readFileSync(join(SRC, 'package.json'), 'utf8'));
  const root = JSON.parse(readFileSync(join(REPO_DIR, 'package.json'), 'utf8'));
  delete pkg.scripts.lightpath;
  // Used only by demo/, which the trial doesn't have.
  delete pkg.devDependencies.gifenc;
  delete pkg.devDependencies.pngjs;
  pkg.devDependencies = {
    ...pkg.devDependencies,
    '@types/node': root.devDependencies['@types/node'],
    typescript: root.devDependencies.typescript,
  };
  return pkg;
}

/** The app's own ports, moved off 3002/5174 so a trial never meets the repo's demo. */
function withPorts(rel, text) {
  if (rel === join('server', 'index.ts'))
    return text.replace('const port = 3002;', `const port = ${API_PORT};`);
  if (rel === 'vite.config.ts')
    return text.replace('port: 5174,', `port: ${WEB_PORT},`).replace('http://127.0.0.1:3002', API_URL);
  return text;
}

export function prepareTemplate(log = console.log) {
  const files = appFiles();
  const parts = [
    `v${TEMPLATE_VERSION}`,
    JSON.stringify(standaloneTsconfig()),
    JSON.stringify(standalonePackageJson()),
  ];
  for (const f of files) parts.push(relative(SRC, f), readFileSync(f, 'utf8'));
  const dir = join(CACHE_DIR, `invoices-template-${sha256(parts.join('\0')).slice(0, 12)}`);
  if (existsSync(join(dir, '.ready'))) return dir;
  log(`building invoices template ${dir}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const rel = relative(SRC, f);
    const target = join(dir, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, withPorts(rel, readFileSync(f, 'utf8')));
  }
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(standaloneTsconfig(), null, 2)}\n`);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(standalonePackageJson(), null, 2)}\n`);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.lightpath/\n*.log\n');
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: dir,
    check: true,
    timeoutMs: 600_000,
  });
  writeFileSync(join(dir, '.ready'), `${new Date().toISOString()}\n`);
  return dir;
}

function sourceCopy(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (p) => {
      const rel = relative(from, p);
      return !rel || (!NOT_SOURCE.has(rel.split(sep)[0]) && basename(p) !== '.ready');
    },
  });
}

export function applyPatch(dir, patch, { reverse = false } = {}) {
  const args = ['apply', '--whitespace=nowarn'];
  if (reverse) args.push('-R');
  run('git', [...args, patch], { cwd: dir, check: true });
}

export function createTrial({ id, bugDir, template, fresh = false }) {
  const dir = join(TRIALS_ROOT, id);
  const pristine = join(TRIALS_ROOT, '_pristine', id);
  for (const d of [dir, pristine]) {
    if (!existsSync(d)) continue;
    if (!fresh) throw new Error(`trial folder already exists: ${d} (use --fresh to replace it)`);
    if (!d.startsWith(TRIALS_ROOT + sep)) throw new Error(`refusing to delete ${d}`);
    rmSync(d, { recursive: true, force: true });
  }
  if (run('git', ['rev-parse', '--git-dir'], { cwd: TRIALS_ROOT }).code === 0) {
    throw new Error(`${TRIALS_ROOT} is inside a git repository; trials must not be`);
  }
  cpSync(template, dir, { recursive: true, filter: (p) => !p.endsWith(`${sep}.ready`) });
  applyPatch(dir, join(bugDir, 'bug.patch'));
  mkdirSync(pristine, { recursive: true });
  sourceCopy(dir, pristine);
  return dir;
}

export function refreshPristine(trialDir) {
  const pristine = join(TRIALS_ROOT, '_pristine', basename(trialDir));
  if (!pristine.startsWith(TRIALS_ROOT + sep)) throw new Error(`refusing to delete ${pristine}`);
  rmSync(pristine, { recursive: true, force: true });
  mkdirSync(pristine, { recursive: true });
  sourceCopy(trialDir, pristine);
}

function listSource(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (dir === root && NOT_SOURCE.has(name)) continue;
    if (name === 'node_modules') continue;
    if (statSync(path).isDirectory()) listSource(root, path, out);
    else out.push(relative(root, path));
  }
  return out;
}

export function agentDiff(trialDir) {
  const pristine = join(TRIALS_ROOT, '_pristine', basename(trialDir));
  const a = new Set(listSource(pristine));
  const b = new Set(listSource(trialDir));
  const changed = [];
  for (const rel of new Set([...a, ...b])) {
    if (!a.has(rel) || !b.has(rel)) changed.push(rel);
    else if (sha256File(join(pristine, rel)) !== sha256File(join(trialDir, rel))) changed.push(rel);
  }
  changed.sort();
  let diff = '';
  const stat = [];
  for (const rel of changed) {
    const left = a.has(rel) ? join(pristine, rel) : isWindows ? 'NUL' : '/dev/null';
    const right = b.has(rel) ? join(trialDir, rel) : isWindows ? 'NUL' : '/dev/null';
    diff += run('git', ['diff', '--no-index', '--no-color', left, right], { cwd: TRIALS_ROOT }).stdout;
    stat.push(`${rel}${a.has(rel) ? (b.has(rel) ? '' : ' (deleted)') : ' (new)'}`);
  }
  return { stat: stat.join('\n'), diff };
}

/** The app's own typecheck script: `tsc -p .`. */
export function typecheck(dir) {
  const res = run(process.execPath, [join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', '.'], {
    cwd: dir,
    timeoutMs: 180_000,
  });
  return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() };
}

export function assertPortsFree() {
  const busy = listeners(PORTS);
  if (busy.length > 0) {
    throw new Error(
      `app ports busy: ${busy.map((b) => `${b.port} pid ${b.pid} (${b.commandLine})`).join('; ')}`,
    );
  }
}

async function waitPortsFree(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && listeners(PORTS).length > 0) await sleep(500);
  assertPortsFree();
}

/** Starts `node dev.mjs` (tsx watch + Vite). The data lives in memory, so every start is fresh. */
export async function startApp(dir, logFile, timeoutMs = 90_000) {
  await waitPortsFree();
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['dev.mjs'], {
    cwd: dir,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  closeSync(fd);
  const stop = () => killTree(child.pid);
  try {
    await Promise.all([
      waitForHttp(`${API_URL}/api/invoices`, timeoutMs, { anyStatus: true }),
      waitForHttp(`${WEB_URL}/`, timeoutMs, { anyStatus: true }),
    ]);
  } catch (err) {
    stop();
    throw err;
  }
  return { pid: child.pid, stop };
}

export function cleanupTrial(dir, startedAtIso) {
  const killed = [];
  const leftAlone = [];
  for (const proc of processesMentioning(dir)) {
    killTree(proc.pid);
    killed.push(proc);
  }
  for (const row of listeners(PORTS)) {
    const startedAfter = row.created && startedAtIso && row.created >= startedAtIso;
    const mentions = row.commandLine?.toLowerCase().includes(dir.toLowerCase());
    if (startedAfter || mentions) {
      killTree(row.pid);
      killed.push(row);
    } else leftAlone.push(row);
  }
  return { killed, leftAlone };
}

const requireFromBrowser = createRequire(join(REPO_DIR, 'packages', 'browser', 'package.json'));
class CheckFailure extends Error {}

function makeKit(state) {
  return {
    webUrl: WEB_URL,
    expect(condition, message) {
      if (!condition) throw new CheckFailure(message);
    },
    async api(method, path, body) {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      try {
        return { status: res.status, body: JSON.parse(text) };
      } catch {
        return { status: res.status, body: text };
      }
    },
    async page() {
      if (!state.browser) {
        const { chromium } = requireFromBrowser('playwright-core');
        state.browser = await chromium.launch({ headless: true });
      }
      const context = await state.browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await page.goto(WEB_URL);
      return page;
    },
    sleep,
  };
}

export async function runCheck({ bugDir, trialDir, logFile, timeoutMs = 120_000 }) {
  const started = Date.now();
  const state = { browser: null };
  let app = null;
  try {
    app = await startApp(trialDir, logFile);
    const mod = await import(`${pathToFileURL(join(bugDir, 'check.mjs')).href}?t=${Date.now()}`);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CheckFailure(`check timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    try {
      const detail = await Promise.race([mod.default(makeKit(state)), timeout]);
      return { pass: true, detail: detail ?? 'ok', ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const detail = err instanceof CheckFailure ? err.message : `error: ${err?.stack ?? err}`;
    return { pass: false, detail, ms: Date.now() - started };
  } finally {
    await state.browser?.close().catch(() => {});
    app?.stop();
    await waitPortsFree().catch(() => {});
  }
}
