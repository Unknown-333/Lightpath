// Shared helpers for the accuracy audit: processes, waits, the MCP client, the repo's packages.
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const accuracyDir = join(here, '..');
export const repo = join(accuracyDir, '..', '..');
export const node = process.execPath;
export const cliBin = join(repo, 'packages', 'cli', 'dist', 'bin.js');
export const registerUrl = pathToFileURL(join(repo, 'packages', 'node-agent', 'dist', 'register.js')).href;

const pkg = (name) => new URL(`../../../packages/${name}/dist/index.js`, import.meta.url).href;
export const core = await import(pkg('core'));
export const daemonPkg = await import(pkg('daemon'));
export const browserPkg = await import(pkg('browser'));
export const mcpPkg = await import(pkg('mcp'));

const requireMcp = createRequire(join(repo, 'packages', 'mcp', 'package.json'));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(what, fn, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Starts a process and collects its output; `ready` is a regex its output must match. */
export async function startProcess(command, args, { cwd, env, ready, name }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  child.stdout.on('data', (c) => {
    output += c;
  });
  child.stderr.on('data', (c) => {
    output += c;
  });
  const exited = new Promise((r) => child.once('exit', r));
  const match = await until(
    `${name} to start`,
    () => {
      if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}:\n${output}`);
      return ready.exec(output);
    },
    30_000,
  );
  return {
    child,
    match,
    output: () => output,
    exited,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGTERM');
      } catch {}
      await exited;
    },
  };
}

/** An MCP client on `lightpath mcp --root <root>`, the server an agent talks to. */
export async function mcpClient(root) {
  const client = new Client({ name: 'accuracy-audit', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: node, args: [cliBin, 'mcp', '--root', root] }));
  return {
    async call(name, args) {
      const res = await client.callTool({ name, arguments: args });
      return res.content?.[0]?.text ?? '';
    },
    close: () => client.close(),
  };
}

/** The trace id an answer starts with (`Trace t_…:`). */
export const traceIdOf = (answer) => /Trace (t_[a-z0-9]{12})/.exec(answer)?.[1];
