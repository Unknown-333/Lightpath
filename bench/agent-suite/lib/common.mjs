// Shared paths and process helpers for the seeded-bug suite (D-108).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = resolve(SUITE_DIR, '../..');
export const SHOP_DIR = join(REPO_DIR, 'examples', 'shop');
export const BUGS_DIR = join(SUITE_DIR, 'bugs');
// Trials live outside the repo so the agent can't see the suite, the checks or git history.
export const TRIALS_ROOT = resolve(process.env.LP_TRIALS_ROOT ?? join(tmpdir(), 'lp-agent-trials'));
export const CACHE_DIR = join(TRIALS_ROOT, '_cache');
export const API_PORT = 3001;
export const WEB_PORT = 5173;
export const SHOP_PORTS = [API_PORT, WEB_PORT];
export const isWindows = process.platform === 'win32';

/** Runs a command and returns its output. `check: true` throws on a non-zero exit. */
export function run(cmd, args, { cwd, check = false, shell = false, timeoutMs, env } = {}) {
  // With a shell, Node wants one command string. Callers only pass fixed, space-free arguments here.
  const res = spawnSync(shell ? [cmd, ...args].join(' ') : cmd, shell ? [] : args, {
    cwd,
    shell,
    env: env ?? process.env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const out = {
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error,
  };
  if (check && out.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${out.code}): ${out.stderr || out.stdout || out.error}`,
    );
  }
  return out;
}

/** npm is a .cmd shim on Windows, which Node only spawns through a shell. Arguments here are fixed strings. */
export function npm(args, opts = {}) {
  return run(isWindows ? 'npm.cmd' : 'npm', args, { ...opts, shell: isWindows });
}

export function powershell(script, opts = {}) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], opts);
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Kills one process and all its children, by PID only (never by name). */
export function killTree(pid) {
  if (!pid) return;
  if (isWindows) {
    run('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

/** Processes listening on the given ports: [{ port, pid, created, commandLine }]. */
export function listeners(ports) {
  if (isWindows) {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$rows = foreach ($p in @(${ports.join(',')})) {
  foreach ($c in @(Get-NetTCPConnection -LocalPort $p -State Listen)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
    [pscustomobject]@{ port = $p; pid = [int]$c.OwningProcess; created = if ($proc) { $proc.CreationDate.ToUniversalTime().ToString('o') } else { $null }; commandLine = if ($proc) { $proc.CommandLine } else { $null } }
  }
}
ConvertTo-Json -Compress -InputObject @($rows)`;
    const res = powershell(script);
    const text = res.stdout.trim();
    if (!text) return [];
    const rows = JSON.parse(text);
    const unique = new Map();
    for (const row of Array.isArray(rows) ? rows : [rows]) unique.set(`${row.port}:${row.pid}`, row);
    return [...unique.values()];
  }
  const rows = [];
  for (const port of ports) {
    const res = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    for (const pid of res.stdout.split(/\s+/).filter(Boolean)) {
      const args = run('ps', ['-o', 'args=', '-p', pid]).stdout.trim();
      rows.push({ port, pid: Number(pid), created: null, commandLine: args });
    }
  }
  return rows;
}

/** Processes whose command line mentions `dir` (the trial folder): [{ pid, created, commandLine }]. Windows only. */
export function processesMentioning(dir) {
  if (!isWindows) return [];
  const needle = dir.replaceAll("'", "''");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$needle = '${needle}'
$rows = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.ProcessId -ne $PID } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; created = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $_.CommandLine } }
ConvertTo-Json -Compress -InputObject @($rows)`;
  const text = powershell(script).stdout.trim();
  if (!text) return [];
  const rows = JSON.parse(text);
  return Array.isArray(rows) ? rows : [rows];
}

/** Total CPU load in percent, or null where the counter isn't available. */
export function cpuLoad() {
  if (!isWindows) return null;
  const res = powershell(
    "(Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 2).CounterSamples | Measure-Object -Property CookedValue -Average | ForEach-Object { [math]::Round($_.Average, 1) }",
  );
  const value = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls `url` until it answers (any status with `anyStatus`, else a 2xx). */
export async function waitForHttp(url, timeoutMs, { anyStatus = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await res.arrayBuffer();
      if (res.ok || anyStatus) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err?.cause?.code ?? err?.message ?? err);
    }
    await sleep(250);
  }
  throw new Error(`${url} not ready after ${timeoutMs} ms (${last})`);
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(arg);
  }
  return out;
}
