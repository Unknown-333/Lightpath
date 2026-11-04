// Suite v2's Actual Budget (SELECTION.md amendment 8): browser mode only, no sync server. The
// template is `git archive` of the pin plus `yarn install`; trials are copies with no .git.
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
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CACHE_DIR,
  isWindows,
  killTree,
  listeners,
  processesMentioning,
  REPO_DIR,
  run,
  sha256File,
  sleep,
  TRIALS_ROOT,
  waitForHttp,
} from '../../agent-suite/lib/common.mjs';

const DEV_MJS = join(dirname(fileURLToPath(import.meta.url)), '..', 'actual-dev.mjs');
export const APP = {
  name: 'actual',
  repo: 'https://github.com/actualbudget/actual.git',
  commit: '502e61ef38bb1a4301239c2af10868dad439389f',
};
export const WEB_PORT = 8613;
export const PORTS = [WEB_PORT];
export const WEB_URL = `http://localhost:${WEB_PORT}`;
const NOT_SOURCE = new Set(['node_modules', '.kiro', '.git', '.lightpath', 'lib-dist', '.yarn']);

export function prepareTemplate(log = console.log) {
  const devMjs = readFileSync(DEV_MJS, 'utf8');
  const dir = join(CACHE_DIR, `actual-${APP.commit.slice(0, 8)}`);
  if (existsSync(join(dir, '.ready'))) {
    if (readFileSync(join(dir, 'dev.mjs'), 'utf8') !== devMjs) writeFileSync(join(dir, 'dev.mjs'), devMjs);
    return dir;
  }
  const src = process.env.LP_ACTUAL_SRC;
  if (!src) throw new Error('set LP_ACTUAL_SRC to an Actual clone that has the pinned commit');
  log(`building Actual template ${dir}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  run('git', ['-C', src, 'archive', '--format=tar', '-o', `${dir}.tar`, APP.commit], { check: true });
  run('tar', ['-xf', `${dir}.tar`, '-C', dir], { check: true });
  rmSync(`${dir}.tar`, { force: true });
  writeFileSync(join(dir, 'dev.mjs'), devMjs);
  const res = run(
    isWindows ? 'cmd' : 'corepack',
    [...(isWindows ? ['/c', 'corepack'] : []), 'yarn', 'install', '--mode=skip-build'],
    {
      cwd: dir,
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
      timeoutMs: 1_200_000,
    },
  );
  if (res.code !== 0)
    throw new Error(`yarn install failed: ${res.stdout.slice(-2000)}${res.stderr.slice(-2000)}`);
  writeFileSync(join(dir, '.ready'), `${new Date().toISOString()}\n`);
  return dir;
}

function copyTree(from, to) {
  if (isWindows) {
    const res = run('robocopy', [
      from,
      to,
      '/E',
      '/MT:16',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP',
      '/XF',
      '.ready',
    ]);
    if (res.code >= 8) throw new Error(`robocopy ${from} -> ${to} failed (${res.code})`);
  } else cpSync(from, to, { recursive: true, filter: (p) => !p.endsWith(`${sep}.ready`) });
}

function sourceCopy(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (p) => {
      const rel = relative(from, p);
      const parts = rel.split(sep);
      return (
        !rel || (!NOT_SOURCE.has(parts[0]) && !parts.includes('node_modules') && basename(p) !== '.ready')
      );
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
  copyTree(template, dir);
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
    if ((dir === root && NOT_SOURCE.has(name)) || name === 'node_modules') continue;
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

/** The web app's own type build: `tsgo -b` in packages/desktop-client (its `typecheck` script's first step). */
function tsgoErrors(dir) {
  const web = join(dir, 'packages', 'desktop-client');
  const bin = join(dir, 'node_modules', '.bin', isWindows ? 'tsgo.cmd' : 'tsgo');
  const res = isWindows
    ? run('cmd', ['/c', bin, '-b'], { cwd: web, timeoutMs: 600_000 })
    : run(bin, ['-b'], { cwd: web, timeoutMs: 600_000 });
  return `${res.stdout}${res.stderr}`
    .split(/\r?\n/)
    .filter((l) => /error TS\d+/.test(l))
    .sort();
}

/**
 * The web app's type build, `tsgo -b` in packages/desktop-client (its `typecheck` script's first
 * step). Errors reported inside node_modules are left out: in a copied trial the workspace links
 * become plain folders without their generated files, so those errors are the copy's, not the
 * app's. "ok" means no type error in the app's own source.
 */
export function typecheck(dir) {
  const own = tsgoErrors(dir).filter((l) => !/node_modules[\\/]/.test(l));
  return { ok: own.length === 0, output: own.join('\n') };
}
export function assertPortsFree() {
  const busy = listeners(PORTS);
  if (busy.length > 0)
    throw new Error(`app ports busy: ${busy.map((b) => `${b.port} pid ${b.pid}`).join('; ')}`);
}

async function waitPortsFree(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && listeners(PORTS).length > 0) await sleep(500);
  assertPortsFree();
}

export async function startApp(dir, logFile, timeoutMs = 180_000) {
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
    await waitForHttp(`${WEB_URL}/`, timeoutMs, { anyStatus: true });
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
    if (startedAfter || row.commandLine?.toLowerCase().includes(dir.toLowerCase())) {
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
    /** A fresh browser profile with Actual's demo budget open ("Try the demo"). */
    async demoPage() {
      if (!state.browser) {
        const { chromium } = requireFromBrowser('playwright-core');
        state.browser = await chromium.launch({ headless: true });
      }
      const context = await state.browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(WEB_URL);
      await page.getByRole('button', { name: 'Try the demo' }).click();
      await page.getByText('Bank of America').first().waitFor({ timeout: 60_000 });
      return page;
    },
    sleep,
  };
}

export async function runCheck({ bugDir, trialDir, logFile, timeoutMs = 240_000 }) {
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
