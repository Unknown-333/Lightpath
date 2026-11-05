// D-157: a first `npx` install must run to the end. Killing it part way leaves `_npx/<hash>` with no
// package.json, and every later start of that spec fails with ENOENT.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupChecks } from '../src/doctor.js';
import { init } from '../src/init.js';
import {
  brokenNpxDir,
  npxVersionArgs,
  type ProbeResult,
  removeDirCommand,
  type WarmResult,
  warmNpx,
} from '../src/mcp-probe.js';

const TOOLS = ['run_action', 'list_traces', 'get_trace', 'find_code_for_action', 'diff_traces'];
const V = '9.9.9';
const SPEC = `@lightpath-dev/cli@${V}`;
const NPX_DIR = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\cache\\_npx\\a0cfaef848df10da';
// The npm error from the Windows first-run job on main (193d2fb).
const ENOENT = `npm error code ENOENT\nnpm error syscall open\nnpm error path ${NPX_DIR}\\package.json\nnpm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${NPX_DIR}\\package.json'\n`;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lightpath warm '));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('npxVersionArgs', () => {
  it('swaps the last mcp for --version on npx commands only', () => {
    expect(npxVersionArgs('cmd', ['/c', 'npx', '-y', SPEC, 'mcp'])).toEqual([
      '/c',
      'npx',
      '-y',
      SPEC,
      '--version',
    ]);
    expect(npxVersionArgs('npx', ['-y', SPEC, 'mcp'])).toEqual(['-y', SPEC, '--version']);
    expect(npxVersionArgs('node', ['bin.js', 'mcp'])).toBeUndefined();
    expect(npxVersionArgs('npx', ['-y', SPEC, 'dev'])).toBeUndefined();
  });
});

describe('brokenNpxDir and removeDirCommand', () => {
  it('names the folder from the npm error, and nothing for other errors', () => {
    expect(brokenNpxDir(ENOENT)).toBe(NPX_DIR);
    expect(brokenNpxDir('npm error code ENOTCACHED\n')).toBeUndefined();
    expect(brokenNpxDir('ENOENT: no such file, open /app/package.json')).toBeUndefined();
  });

  it('gives a command that removes the folder in this OS shell', () => {
    const target = join(dir, '_npx', 'a0cfaef848df10da');
    mkdirSync(join(target, 'node_modules'), { recursive: true });
    execSync(removeDirCommand(target), { stdio: 'ignore' });
    expect(existsSync(target)).toBe(false);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('warmNpx', () => {
  const slow = (ms: number, file: string) => [
    '-e',
    `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(file)}, 'done'); console.log('1.0.0'); }, ${ms})`,
  ];

  it('waits for the command to end', async () => {
    const file = join(dir, 'done.txt');
    const w = await warmNpx(process.execPath, slow(300, file), { cwd: dir, waitMs: 10_000 });
    expect(w).toMatchObject({ ok: true, exit: '0' });
    expect(w.ms).toBeGreaterThanOrEqual(250);
    expect(existsSync(file)).toBe(true);
  });

  it('returns at waitMs and leaves the command running to its end, never killed', async () => {
    const file = join(dir, 'done.txt');
    const w = await warmNpx(process.execPath, slow(1500, file), { cwd: dir, waitMs: 200 });
    expect(w).toMatchObject({ ok: false, running: true });
    expect(existsSync(file)).toBe(false);
    await new Promise((r) => setTimeout(r, 3000));
    expect(existsSync(file)).toBe(true);
  });

  it('reports a failed command with its exit code and stderr', async () => {
    const w = await warmNpx(process.execPath, ['-e', 'console.error("nope"); process.exit(3)'], { cwd: dir });
    expect(w).toMatchObject({ ok: false, exit: '3' });
    expect(w.stderr).toContain('nope');
  });
});

describe('doctor runs the npx install to its end before the 20 s probe', () => {
  const checkWith = async (warm: WarmResult, probe: ProbeResult = { ok: true, tools: TOOLS, stderr: '' }) => {
    await init({
      cwd: dir,
      agent: 'claude-code',
      version: V,
      tools: TOOLS,
      platform: 'win32',
      out: () => {},
    });
    const order: string[] = [];
    const checks = await setupChecks(dir, undefined, {
      platform: 'win32',
      version: V,
      tools: TOOLS,
      warm: async (c, a, o) => {
        order.push(['warm', c, ...a, o.env?.npm_config_offline ?? ''].join(' '));
        return warm;
      },
      probe: async (c, a) => {
        order.push(['probe', c, ...a].join(' '));
        return probe;
      },
    });
    const check = checks.find((c) => c.name === 'Claude Code MCP config');
    return { result: await check?.run(), order };
  };

  it('installs with --version offline first, then probes the MCP command', async () => {
    const { result, order } = await checkWith({ ok: true, ms: 23_400, stderr: '', exit: '0' });
    expect(order).toEqual([`warm cmd /c npx -y ${SPEC} --version true`, `probe cmd /c npx -y ${SPEC} mcp`]);
    expect(result).toMatchObject({ ok: true });
    expect(result?.detail).toContain('starts and lists 5 tools (npx installed it first, 23.4 s)');
  });

  it('says plainly when npx is still installing, and does not probe', async () => {
    const { result, order } = await checkWith({ ok: false, running: true, ms: 180_000, stderr: '' });
    expect(order).toHaveLength(1);
    expect(result).toMatchObject({ ok: true });
    expect(result?.detail).toContain(
      `npx is still installing ${SPEC} after 180 s (first start); not checked yet`,
    );
  });

  it('names a broken _npx folder and gives the command that removes it', async () => {
    const { result, order } = await checkWith({ ok: false, exit: '4294963238', ms: 900, stderr: ENOENT });
    expect(order).toHaveLength(1);
    expect(result).toMatchObject({ ok: false });
    expect(result?.detail).toContain(`npx's folder ${NPX_DIR} has no package.json`);
    expect(result?.detail).toContain(removeDirCommand(NPX_DIR));
  });

  it('still says npx would download when the package is not cached', async () => {
    const { result } = await checkWith({
      ok: false,
      exit: '1',
      ms: 900,
      stderr: 'npm error code ENOTCACHED\n',
    });
    expect(result).toMatchObject({ ok: true });
    expect(result?.detail).toContain('npx would download');
  });

  it('names a broken folder seen by the probe too', async () => {
    const { result } = await checkWith(
      { ok: true, ms: 10, stderr: '', exit: '0' },
      { ok: false, error: 'exited before answering', exit: '1', stderr: ENOENT },
    );
    expect(result).toMatchObject({ ok: false });
    expect(result?.detail).toContain(removeDirCommand(NPX_DIR));
  });
});

describe('init installs the pinned CLI through npx before the first start', () => {
  const initWith = async (warm: WarmResult) => {
    const lines: string[] = [];
    const calls: string[] = [];
    const code = await init({
      cwd: dir,
      agent: 'claude-code',
      version: V,
      tools: TOOLS,
      platform: 'win32',
      out: (l) => lines.push(l),
      warm: async (c, a, o) => {
        calls.push([c, ...a, o.env?.npm_config_prefer_offline ?? ''].join(' '));
        return warm;
      },
    });
    return { code, lines, calls };
  };

  it('runs the configured spec with --version, then says it is ready', async () => {
    const { code, lines, calls } = await initWith({ ok: true, ms: 12_300, stderr: '', exit: '0' });
    expect(code).toBe(0);
    expect(calls).toEqual([`cmd /c npx -y ${SPEC} --version true`]);
    expect(lines).toContain(`ready     npx has ${SPEC} (12.3 s)`);
    expect(lines.at(-1)).toContain('Done. Restart Claude Code');
  });

  it('exits 1 with the remove command when the npx folder is broken', async () => {
    const { code, lines } = await initWith({ ok: false, exit: '4294963238', ms: 900, stderr: ENOENT });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain(removeDirCommand(NPX_DIR));
  });

  it('keeps exit 0 when npx can only install later', async () => {
    const { code, lines } = await initWith({
      ok: false,
      exit: '1',
      ms: 900,
      stderr: 'npm error code E404\n',
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('the first start will try again');
  });

  it('runs no npx without the warm option (tests, library use)', async () => {
    const lines: string[] = [];
    await init({
      cwd: dir,
      agent: 'claude-code',
      version: V,
      tools: TOOLS,
      platform: 'win32',
      out: (l) => lines.push(l),
    });
    expect(lines.some((l) => l.startsWith('npx '))).toBe(false);
  });
});
