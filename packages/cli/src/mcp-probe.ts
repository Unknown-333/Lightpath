import { spawn } from 'node:child_process';
import { createMcpServer } from '@lightpath-dev/mcp';

type JsonRpc = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const initialize = (id: number, version: string): JsonRpc => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'lightpath-setup-check', version },
  },
});

const toolNamesOf = (result: unknown): string[] =>
  ((result as { tools?: { name: string }[] } | undefined)?.tools ?? []).map((t) => t.name);

/**
 * The tool names this CLI's own MCP server ships, read from its `tools/list` in this process (no
 * child, no network). `lightpath init` builds the AGENTS.md block from this list (D-120), so the
 * block follows the server when tools are added or renamed.
 */
export async function serverToolNames(version: string): Promise<string[]> {
  const server = createMcpServer({ workspaceRoot: process.cwd() });
  const waiting = new Map<number, (m: JsonRpc) => void>();
  const transport = {
    onmessage: undefined as ((m: JsonRpc) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((e: Error) => void) | undefined,
    async start() {},
    async close() {
      transport.onclose?.();
    },
    async send(m: JsonRpc) {
      if (typeof m.id === 'number') waiting.get(m.id)?.(m);
    },
  };
  // The SDK's Transport is structural; this object has every member it calls.
  await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
  const ask = (m: JsonRpc) =>
    new Promise<JsonRpc>((resolve) => {
      waiting.set(m.id as number, resolve);
      transport.onmessage?.(m);
    });
  try {
    await ask(initialize(1, version));
    transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const reply = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    if (reply.error) throw new Error(`tools/list failed: ${JSON.stringify(reply.error)}`);
    return toolNamesOf(reply.result);
  } finally {
    await server.close();
  }
}

export interface ProbeResult {
  ok: boolean;
  /** Tool names from `tools/list`, when the server answered. */
  tools?: string[];
  /** What went wrong, when it didn't. */
  error?: string;
  /** The last part of the child's stderr, for the message. */
  stderr: string;
  /** Exit code or signal, when the child ended before answering. */
  exit?: string;
}

/**
 * Starts an MCP server command exactly as a client would, with no shell, and asks it for
 * `initialize` and `tools/list` over stdio (newline-delimited JSON-RPC). Kills the child when done.
 */
export function probeMcpCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; version?: string },
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let buffer = '';
    let settled = false;
    let initialized = false;
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (r: Omit<ProbeResult, 'stderr'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin?.end();
      if (child.exitCode === null && child.signalCode === null) killTree(child.pid);
      resolve({ ...r, stderr: stderr.slice(-2000) });
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `no answer within ${(options.timeoutMs ?? 20_000) / 1000} s` }),
      options.timeoutMs ?? 20_000,
    );
    const write = (m: JsonRpc) => child.stdin?.write(`${JSON.stringify(m)}\n`);
    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.stdin?.on('error', () => {}); // EPIPE when the child dies first; 'exit' reports it
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d;
    });
    child.on('exit', (code, signal) =>
      finish({ ok: false, error: 'exited before answering', exit: signal ?? String(code) }),
    );
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let m: JsonRpc;
        try {
          m = JSON.parse(line) as JsonRpc;
        } catch {
          finish({ ok: false, error: `not JSON-RPC on stdout: ${line.slice(0, 200)}` });
          return;
        }
        if (m.id === 1 && !initialized) {
          if (m.error) return finish({ ok: false, error: `initialize failed: ${JSON.stringify(m.error)}` });
          initialized = true;
          write({ jsonrpc: '2.0', method: 'notifications/initialized' });
          write({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 2) {
          if (m.error) return finish({ ok: false, error: `tools/list failed: ${JSON.stringify(m.error)}` });
          finish({ ok: true, tools: toolNamesOf(m.result) });
        }
      }
    });
    write(initialize(1, options.version ?? '0.0.0'));
  });
}

/**
 * The same command with `--version` in place of its last `mcp`, when it starts the server through
 * npx; undefined otherwise. npx keys its install folder on the package spec, not the arguments,
 * so this installs exactly what the MCP command will run (D-157).
 */
export function npxVersionArgs(command: string, args: readonly string[]): string[] | undefined {
  const viaNpx = command === 'npx' || (command === 'cmd' && args.includes('npx'));
  if (!viaNpx || args[args.length - 1] !== 'mcp') return undefined;
  return [...args.slice(0, -1), '--version'];
}

export interface WarmResult {
  ok: boolean;
  /** How long it ran, in ms. */
  ms: number;
  stderr: string;
  /** Exit code, when it ended. */
  exit?: string;
  /** Still running after `waitMs`. It's left to finish, never killed. */
  running?: boolean;
}

/**
 * Runs a command to the end and never kills it (D-157). Killing npx while it installs a package
 * for the first time leaves `_npx/<hash>` without its package.json, and every later start of that
 * spec fails with ENOENT. After `waitMs` the call returns `running` and leaves the child to finish.
 */
export function warmNpx(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; waitMs?: number },
): Promise<WarmResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stderr = '';
    let settled = false;
    const done = (r: Omit<WarmResult, 'ms' | 'stderr'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, ms: Date.now() - started, stderr: stderr.slice(-2000) });
    };
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout?.resume();
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d;
    });
    child.on('error', (err) => {
      stderr += err.message;
      done({ ok: false });
    });
    child.on('exit', (code, signal) => done({ ok: code === 0, exit: signal ?? String(code) }));
    const timer = setTimeout(() => {
      // Let this process exit without waiting for, or stopping, the install.
      child.unref();
      (child.stdout as unknown as { unref?: () => void } | null)?.unref?.();
      (child.stderr as unknown as { unref?: () => void } | null)?.unref?.();
      done({ ok: false, running: true });
    }, options.waitMs ?? 180_000);
  });
}

/** The `_npx/<hash>` folder an npm ENOENT on its package.json names: a first install that was cut off. */
export function brokenNpxDir(stderr: string): string | undefined {
  if (!/ENOENT/.test(stderr)) return undefined;
  return /([^\s'"]*[\\/]_npx[\\/][0-9a-f]+)[\\/]package\.json/.exec(stderr)?.[1];
}

/** Removes a folder; the same text works in cmd, PowerShell and POSIX shells. */
export const removeDirCommand = (dir: string): string =>
  `node -e "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" "${dir}"`;

/** Stops a child and, on Windows, everything it started (cmd → npx → node). */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).on(
      'error',
      () => {},
    );
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}
