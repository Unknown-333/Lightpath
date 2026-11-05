// The "with" condition (D-108, D-130): packs this checkout's Lightpath packages into tarballs and
// installs them outside the repo, runs `lightpath init --agent kiro` in the trial folder from that
// pack, and runs the app under `lightpath dev`. Nothing is published: `pnpm pack` writes local
// .tgz files only.
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CACHE_DIR, isWindows, killTree, npm, REPO_DIR, run, sleep } from './common.mjs';

const PACKAGES = ['protocol', 'core', 'browser', 'daemon', 'mcp', 'node-agent', 'cli'];

/** Returns { dir, bin, version, commit } for an install of the packed branch under test. */
export function prepareLightpath(log = console.log) {
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR, check: true }).stdout.trim();
  const dirty =
    run('git', ['status', '--porcelain', '--', 'packages'], { cwd: REPO_DIR }).stdout.trim() !== '';
  const dir = join(CACHE_DIR, `lightpath-${commit.slice(0, 12)}${dirty ? '-dirty' : ''}`);
  const bin = join(dir, 'node_modules', '@lightpath-dev', 'cli', 'dist', 'bin.js');
  if (!dirty && existsSync(join(dir, '.ready'))) return { dir, bin, commit, dirty, version: version(bin) };

  log(
    `packing Lightpath ${commit.slice(0, 12)}${dirty ? ' (uncommitted changes in packages/)' : ''} into ${dir}`,
  );
  rmSync(dir, { recursive: true, force: true });
  const tgzDir = join(dir, 'tgz');
  mkdirSync(tgzDir, { recursive: true });
  run('pnpm', ['build'], { cwd: REPO_DIR, shell: isWindows, check: true });
  for (const name of PACKAGES) {
    run('pnpm', ['pack', '--pack-destination', tgzDir], {
      cwd: join(REPO_DIR, 'packages', name),
      shell: isWindows,
      check: true,
    });
  }
  writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
  const tarballs = readdirSync(tgzDir)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => `./tgz/${f}`);
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs], { cwd: dir, check: true });
  writeFileSync(join(dir, '.ready'), `${commit}\n`);
  return { dir, bin, commit, dirty, version: version(bin) };
}

function version(bin) {
  return run(process.execPath, [bin, '--version']).stdout.trim();
}

const CLI_SPEC = /^@lightpath-dev\/cli@/;

/**
 * Sets up Lightpath in `trialDir` the way a Kiro user does (D-130): writes the
 * lightpath.config.json keys the app needs (`configKeys`), then runs the packed
 * `lightpath init --agent kiro`. Returns the server entry init wrote, and the one the pinned agent
 * file uses: the same, with `npx -y @lightpath-dev/cli@<v>` replaced by the packed CLI, because the
 * branch under test isn't on npm.
 */
export function initTrial(trialDir, lightpath, configKeys, logFile) {
  const configPath = join(trialDir, 'lightpath.config.json');
  if (existsSync(configPath)) throw new Error(`${configPath} exists before init; the app shouldn't have one`);
  if (Object.keys(configKeys).length > 0) {
    writeFileSync(configPath, `${JSON.stringify(configKeys, null, 2)}\n`);
  }
  const res = run(process.execPath, [lightpath.bin, 'init', '--agent', 'kiro'], {
    cwd: trialDir,
    timeoutMs: 60_000,
  });
  const output = `${res.stdout}${res.stderr}`.trim();
  writeFileSync(logFile, `$ lightpath init --agent kiro (exit ${res.code})\n${output}\n`);
  if (res.code !== 0) throw new Error(`lightpath init failed (${res.code}): ${output}`);
  const mcp = JSON.parse(readFileSync(join(trialDir, '.kiro', 'settings', 'mcp.json'), 'utf8'));
  const initEntry = mcp.mcpServers?.lightpath;
  if (!initEntry || typeof initEntry.command !== 'string' || !Array.isArray(initEntry.args)) {
    throw new Error(`lightpath init wrote no usable "lightpath" server: ${JSON.stringify(mcp)}`);
  }
  const spec = initEntry.args.findIndex((a) => CLI_SPEC.test(a));
  if (spec < 0) throw new Error(`no ${CLI_SPEC} argument in init's entry ${JSON.stringify(initEntry)}`);
  const serverEntry = { command: process.execPath, args: [lightpath.bin, ...initEntry.args.slice(spec + 1)] };
  return {
    initEntry,
    serverEntry,
    initOutput: output,
    configWritten: JSON.parse(readFileSync(configPath, 'utf8')),
    agentsMd: existsSync(join(trialDir, 'AGENTS.md')),
  };
}

/**
 * Starts `lightpath dev` in `trialDir` (it runs the config's command) and waits until it watches
 * the page, so run_action can act on it. Returns { pid, readyMs, stop }.
 */
export async function startLightpathDev(trialDir, lightpath, logFile, timeoutMs = 300_000) {
  // A log left by an earlier start of the same trial id would read "watching" at once (Step 4 dry run).
  rmSync(logFile, { force: true });
  const fd = openSync(logFile, 'a');
  const started = Date.now();
  const child = spawn(process.execPath, [lightpath.bin, 'dev'], {
    cwd: trialDir,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  closeSync(fd);
  let exited = null;
  child.on('exit', (code) => {
    exited = code ?? -1;
  });
  const stop = () => killTree(child.pid);
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    const text = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
    // `\S*` also skips a colour code after the name, if the log has one.
    if (/lightpath\S* watching /.test(text)) {
      return { pid: child.pid, readyMs: Date.now() - started, stop };
    }
    if (/did not answer within|could not start command/.test(text) || exited !== null) {
      stop();
      throw new Error(`lightpath dev did not get ready (exit ${exited}); see ${logFile}`);
    }
    await sleep(500);
  }
  stop();
  throw new Error(`lightpath dev not watching the page after ${timeoutMs} ms; see ${logFile}`);
}

/** True when `url` answers at all within 2 s. */
async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Suite v2 Step 4 (STEP4-RULE.md, item it_eaec2cc9): `lightpath dev` can open the page before the
 * app's API listens, so the page's first data request fails and the page shows no data. After
 * "watching", wait for the API (`backendUrl`); if it wasn't answering when the page opened, re-save
 * the page's HTML file unchanged (`pageHtml`, relative to the trial) so the dev server reloads the
 * page, then wait `settleMs`. Returns what happened, for the run's record.
 */
export async function waitAppBackend(
  trialDir,
  { backendUrl, pageHtml, pageUrl, readyButton },
  timeoutMs = 120_000,
  settleMs = 8000,
) {
  if (readyButton) return waitAppPage(pageUrl, readyButton, 180_000, settleMs);
  if (!backendUrl) return null;
  const upAtReady = await answers(backendUrl);
  const started = Date.now();
  while (!(await answers(backendUrl))) {
    if (Date.now() - started > timeoutMs) throw new Error(`app backend ${backendUrl} not answering after ${timeoutMs} ms`);
    await sleep(500);
  }
  const waitedMs = Date.now() - started;
  let reloaded = false;
  if (!upAtReady && pageHtml) {
    const file = join(trialDir, pageHtml);
    writeFileSync(file, readFileSync(file));
    reloaded = true;
    await sleep(settleMs);
  }
  return { backendUrl, upAtReady, waitedMs, reloaded };
}

/**
 * Actual has no API to wait for: its first screen renders about 18 s after "watching" (measured,
 * STEP4-RULE.md), and a run_action before that answers not_found. So a second headless browser,
 * closed before the agent starts, opens `pageUrl` until `button "<readyButton>"` shows, then the
 * harness waits `settleMs` more for Lightpath's own page, which opened first.
 */
async function waitAppPage(pageUrl, readyButton, timeoutMs, settleMs) {
  const require = createRequire(join(REPO_DIR, 'packages', 'browser', 'package.json'));
  const { chromium } = require('playwright-core');
  const started = Date.now();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
    await page.goto(pageUrl, { timeout: timeoutMs });
    await page.getByRole('button', { name: readyButton }).waitFor({ timeout: timeoutMs });
  } finally {
    await browser.close().catch(() => {});
  }
  const waitedMs = Date.now() - started;
  await sleep(settleMs);
  return { pageUrl, readyButton, waitedMs, settleMs };
}

/**
 * Asks an MCP server for `initialize` and `tools/list` over stdio, started exactly as the agent
 * file gives it (no model call). Returns { tools, instructions }.
 */
export function probeTools(entry, cwd, timeoutMs = 30_000) {
  return new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(entry.command, entry.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let buffer = '';
    let stderr = '';
    let instructions = null;
    const done = (err, value) => {
      clearTimeout(timer);
      child.stdin.end();
      killTree(child.pid);
      if (err) rejectProbe(err);
      else resolveProbe(value);
    };
    const timer = setTimeout(
      () => done(new Error(`no tools/list answer in ${timeoutMs} ms: ${stderr}`)),
      timeoutMs,
    );
    const write = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8').on('data', (d) => {
      stderr += d;
    });
    child.stdout.setEncoding('utf8').on('data', (d) => {
      buffer += d;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.id === 1) {
          instructions = m.result?.instructions ?? null;
          write({ jsonrpc: '2.0', method: 'notifications/initialized' });
          write({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 2) {
          done(null, { tools: (m.result?.tools ?? []).map((t) => t.name), instructions });
        }
      }
    });
    write({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'bench-probe', version: '0' },
      },
    });
  });
}
