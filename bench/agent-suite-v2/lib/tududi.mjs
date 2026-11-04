// Suite v2's tududi: a copy of ../../agent-suite/realapp/lib/app.mjs (v1, D-110, left unchanged)
// with v2's pin, ports, bug folder and dev script. Builds the template, trial copies (no .git,
// by the owner's rule), starts and stops the app, and runs the hidden checks.
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
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

export const SUITE_V2_DIR = resolveDir('..');
export const BUGS_DIR = join(SUITE_V2_DIR, 'bugs');
const DEV_MJS = join(SUITE_V2_DIR, 'tududi-dev.mjs');
export const APP = {
  name: 'tududi',
  repo: 'https://github.com/chrisvel/tududi.git',
  // The newest main commit that still runs on SQLite (2026-10-31); the next one, e77dc529,
  // makes tududi PostgreSQL-only. SELECTION.md, amendment 1.
  commit: 'eda9aa60b16ce657a08b47d1894f5c27bf098586',
};
export const API_PORT = 3611;
export const WEB_PORT = 8611;
export const PORTS = [API_PORT, WEB_PORT];
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const USER = { email: 'dev@tududi.test', password: 'DevPass123!' };
// Files the harness owns or the app writes at run time; left out of the agent's diff.
const NOT_SOURCE = new Set(['node_modules', '.kiro', '.git', 'db', 'uploads', 'dist', '.lightpath']);

function resolveDir(rel) {
  return join(dirname(fileURLToPath(import.meta.url)), rel);
}

/** Builds (once) tududi at the pinned commit with `npm ci`, plus dev.mjs. Returns its path. */
export function prepareTemplate(log = console.log) {
  const devMjs = readFileSync(DEV_MJS, 'utf8');
  const dir = join(CACHE_DIR, `tududi-${APP.commit.slice(0, 8)}-${sha256(devMjs).slice(0, 8)}`);
  if (existsSync(join(dir, '.ready'))) return dir;
  const src = process.env.LP_TUDUDI_SRC ?? join(CACHE_DIR, 'tududi-src');
  if (existsSync(join(src, '.git')) && run('git', ['-C', src, 'cat-file', '-e', APP.commit]).code !== 0) {
    run('git', ['-C', src, 'fetch', '-q', 'origin'], { check: true });
  }
  if (!existsSync(join(src, '.git'))) {
    log(`cloning ${APP.repo} into ${src}`);
    run('git', ['clone', '-q', '--filter=blob:none', APP.repo, src], { check: true });
  }
  log(`building tududi template ${dir}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = join(CACHE_DIR, `tududi-${APP.commit.slice(0, 8)}.tar`);
  run('git', ['-C', src, 'archive', '--format=tar', '-o', tar, APP.commit], { check: true });
  run('tar', ['-xf', tar, '-C', dir], { check: true });
  rmSync(tar, { force: true });
  writeFileSync(join(dir, 'dev.mjs'), devMjs);
  npm(['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, check: true, timeoutMs: 900_000 });
  writeFileSync(join(dir, '.ready'), `${new Date().toISOString()}\n`);
  return dir;
}

function copyTree(from, to) {
  if (isWindows) {
    // robocopy: exit codes below 8 mean success.
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
    if (res.code >= 8) throw new Error(`robocopy ${from} -> ${to} failed (${res.code}): ${res.stdout}`);
  } else {
    cpSync(from, to, { recursive: true, filter: (p) => !p.endsWith(`${sep}.ready`) });
  }
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
  // Outside any repository, `git apply` works like `patch`. The trial has no .git.
  run('git', [...args, patch], { cwd: dir, check: true });
}

/**
 * Creates TRIALS_ROOT/<id>: the template with bug.patch applied and NO .git folder (owner's
 * rule, 2026-11-01: the agent must not find the upstream fix with git log). Also keeps a
 * clean source copy (template + bug.patch, no node_modules) in TRIALS_ROOT/_pristine/<id> to
 * diff the agent's changes against.
 */
export function createTrial({ id, bugDir, template, fresh = false }) {
  const dir = join(TRIALS_ROOT, id);
  const pristine = join(TRIALS_ROOT, '_pristine', id);
  for (const d of [dir, pristine]) {
    if (!existsSync(d)) continue;
    if (!fresh) throw new Error(`trial folder already exists: ${d} (use --fresh to replace it)`);
    if (!d.startsWith(TRIALS_ROOT + sep)) throw new Error(`refusing to delete ${d}`);
    rmSync(d, { recursive: true, force: true });
  }
  if (
    existsSync(join(TRIALS_ROOT, '.git')) ||
    run('git', ['rev-parse', '--git-dir'], { cwd: TRIALS_ROOT }).code === 0
  ) {
    throw new Error(`${TRIALS_ROOT} is inside a git repository; trials must not be`);
  }
  copyTree(template, dir);
  applyPatch(dir, join(bugDir, 'bug.patch'));
  mkdirSync(pristine, { recursive: true });
  sourceCopy(dir, pristine);
  return dir;
}

/**
 * "with" only (D-130): copies the clean source copy again after `lightpath init` wrote its files,
 * so they aren't counted as the agent's changes.
 */
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
    const rel = relative(root, path);
    if (dir === root && NOT_SOURCE.has(name)) continue;
    if (name === 'node_modules') continue;
    if (statSync(path).isDirectory()) listSource(root, path, out);
    else out.push(rel);
  }
  return out;
}

/** The agent's changes: a unified diff of trial vs. pristine source copy. Returns { stat, diff }. */
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
    const res = run('git', ['diff', '--no-index', '--no-color', left, right], { cwd: TRIALS_ROOT });
    diff += res.stdout;
    stat.push(`${rel}${a.has(rel) ? (b.has(rel) ? '' : ' (deleted)') : ' (new)'}`);
  }
  return { stat: stat.join('\n'), diff };
}

/** The app's own typecheck: `tsc --noEmit`, the first step of `npm run frontend:build`. */
export function typecheck(dir) {
  const res = run(process.execPath, [join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], {
    cwd: dir,
    timeoutMs: 300_000,
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

/** Starts `node dev.mjs` in `dir` on a fresh database outside the trial; waits for API and web. */
export async function startApp(dir, logFile, timeoutMs = 180_000) {
  await waitPortsFree();
  const dbDir = join(TRIALS_ROOT, '_db');
  mkdirSync(dbDir, { recursive: true });
  const dbFile = join(dbDir, `${basename(dir)}-${Date.now()}.sqlite3`);
  const { openSync, closeSync } = await import('node:fs');
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['dev.mjs'], {
    cwd: dir,
    env: { ...process.env, DB_FILE: dbFile, PORT: String(API_PORT), FRONTEND_PORT: String(WEB_PORT) },
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  closeSync(fd);
  const stop = () => killTree(child.pid);
  try {
    await Promise.all([
      waitForHttp(`${API_URL}/api/version`, timeoutMs, { anyStatus: true }),
      waitForHttp(`${WEB_URL}/`, timeoutMs, { anyStatus: true }),
    ]);
  } catch (err) {
    stop();
    throw err;
  }
  return { pid: child.pid, stop, dbFile };
}

/** Same rule as the shop: kill only what names the trial folder, or holds an app port and started after the trial began. */
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

// ---- hidden checks ----------------------------------------------------------------------

const requireFromBrowser = createRequire(join(REPO_DIR, 'packages', 'browser', 'package.json'));
class CheckFailure extends Error {}

/** Helpers every real-app check gets. Checks test behaviour (API responses, rendered text). */
function makeKit(state) {
  let cookie = '';
  let csrf = null;
  const kit = {
    apiUrl: API_URL,
    webUrl: WEB_URL,
    user: USER,
    /**
     * v2: runs one SQL statement on the check's own database (outside the trial), with the trial's
     * own sqlite3 driver. For setting up data a user can't make through the UI, such as an old date.
     */
    async sql(statement, params = []) {
      const sqlite3 = createRequire(join(state.trialDir, 'package.json'))('sqlite3');
      const db = new sqlite3.Database(state.dbFile);
      try {
        return await new Promise((done, fail) =>
          db.all(statement, params, (err, rows) => (err ? fail(err) : done(rows))),
        );
      } finally {
        await new Promise((done) => db.close(() => done()));
      }
    },
    expect(condition, message) {
      if (!condition) throw new CheckFailure(message);
    },
    /** JSON API call as the dev user (logs in on first use, sends the CSRF token). */
    async api(method, path, body) {
      if (!cookie) await kit.login();
      if (!csrf && method !== 'GET') csrf = (await raw('GET', '/api/csrf-token')).body?.csrfToken;
      return raw(method, path, body);
    },
    async login() {
      const res = await raw('POST', '/api/login', { email: USER.email, password: USER.password });
      if (res.status !== 200) throw new Error(`login failed: HTTP ${res.status}`);
    },
    /** A browser page signed in as the dev user, past the first-run welcome screen. */
    async page() {
      if (!state.browser) {
        const { chromium } = requireFromBrowser('playwright-core');
        state.browser = await chromium.launch({ headless: true });
      }
      const context = await state.browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await page.goto(`${WEB_URL}/login`);
      await page.fill('input[type="email"]', USER.email);
      await page.fill('input[type="password"]', USER.password);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !/login/.test(u.pathname));
      await page.waitForLoadState('networkidle').catch(() => {});
      if (/welcome/.test(page.url())) {
        await page.getByRole('button', { name: /let's start/i }).click();
        await page.waitForURL((u) => !/welcome/.test(u.pathname));
      }
      return page;
    },
    /** multipart/form-data POST as the dev user: { fields, file: { field, name, type, content } }. */
    async upload(path, { fields = {}, file }) {
      if (!cookie) await kit.login();
      if (!csrf) csrf = (await raw('GET', '/api/csrf-token')).body?.csrfToken;
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append(file.field, new Blob([file.content], { type: file.type }), file.name);
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON
      }
      return { status: res.status, body: parsed };
    },
    sleep,
  };
  async function raw(method, path, body) {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed };
  }
  return kit;
}

/** Starts the trial's app on a fresh database, runs `<bugDir>/check.mjs`, stops the app. */
export async function runCheck({ bugDir, trialDir, logFile, timeoutMs = 180_000 }) {
  const started = Date.now();
  const state = { browser: null, trialDir, dbFile: null };
  let app = null;
  try {
    app = await startApp(trialDir, logFile);
    state.dbFile = app.dbFile;
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
    if (app?.dbFile) {
      // v1 once crashed here with EPERM while the stopped app still held the file (2026-11-01,
      // r03-without-5). v2 waits and retries, and leaves the file behind rather than fail the run.
      for (const f of [app.dbFile, `${app.dbFile}-wal`, `${app.dbFile}-shm`]) {
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            rmSync(f, { force: true });
            break;
          } catch {
            await sleep(500);
          }
        }
      }
    }
  }
}
