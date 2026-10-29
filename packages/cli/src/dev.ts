import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { BrowserCollector } from '@lightpath-dev/browser';
import { type RunningDaemon, startDaemon } from '@lightpath-dev/daemon';
import { registerUrl } from '@lightpath-dev/node-agent';
import type { IngestMessage } from '@lightpath-dev/protocol';
import pc from 'picocolors';
import { UrlWatcher } from './detect.js';
import { agentEnv, nodeVersionProblem, toShellCommand } from './env.js';
import { formatTrace } from './format.js';

export interface DevOptions {
  /**
   * The user's dev command and its arguments, e.g. ['npm', 'run', 'dev'], or one string that runs in
   * a shell (the `command` key in lightpath.config.json).
   */
  command: string[] | string;
  /** App URL; detected from the command's output when omitted. */
  url?: string | undefined;
  /** Directory Vite (or another dev server) serves from. Defaults to cwd. */
  webRoot?: string | undefined;
  /** Extra origins to tag with the trace header, besides the app's own. */
  backend?: string[] | undefined;
  roots?: string[] | undefined;
  /** Globs for workspace files to leave out of traces. */
  ignore?: string[] | undefined;
  settleMs?: number | undefined;
  maxSettleMs?: number | undefined;
  browser?: boolean | undefined;
  headless?: boolean | undefined;
  debug?: boolean | undefined;
  cwd?: string | undefined;
}

const say = (msg: string) => process.stderr.write(`${pc.magenta('lightpath')} ${msg}\n`);

/** `lightpath dev -- <command>` (docs/ARCHITECTURE.md section 9.2). */
export async function dev(options: DevOptions): Promise<number> {
  const problem = nodeVersionProblem(process.version);
  if (problem) {
    say(pc.red(problem));
    return 1;
  }
  const shellLine = typeof options.command === 'string' ? options.command.trim() : undefined;
  const [cmd, ...args] = typeof options.command === 'string' ? [] : options.command;
  if (!cmd && !shellLine) {
    say(
      pc.red(
        'missing command. Usage: lightpath dev -- npm run dev (or set "command" in lightpath.config.json)',
      ),
    );
    return 1;
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const roots = (options.roots?.length ? options.roots : [cwd]).map((r) => resolve(cwd, r));
  const daemon = await startDaemon({
    workspaceRoots: roots,
    ...(options.ignore?.length ? { ignore: options.ignore } : {}),
    ...(options.debug ? { log: say } : {}),
  });
  say(`daemon on ${pc.dim(daemon.url)}`);
  const unsubscribe = daemon.store.subscribe((trace) => {
    if (trace.endedAt !== undefined) process.stdout.write(`\n${formatTrace(trace)}\n`);
  });

  const env = agentEnv(process.env, {
    daemonUrl: daemon.url,
    token: daemon.token,
    roots,
    registerUrl,
    debug: options.debug,
  });
  const spawnOptions = { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] as ['inherit', 'pipe', 'pipe'] };
  // Windows needs a shell so `npm`, `pnpm`, and other `.cmd` shims resolve.
  const child = shellLine
    ? spawn(shellLine, { ...spawnOptions, shell: true })
    : process.platform === 'win32'
      ? spawn(toShellCommand([cmd as string, ...args]), { ...spawnOptions, shell: true })
      : spawn(cmd as string, args, spawnOptions);

  let collector: BrowserCollector | undefined;
  const openBrowser = async (url: string) => {
    if (options.browser === false || collector) return;
    const origin = new URL(url).origin;
    daemon.correlator.addDevServer(origin, resolve(cwd, options.webRoot ?? '.'));
    collector = new BrowserCollector({
      url,
      backendOrigins: [origin, ...(options.backend ?? [])],
      ...(options.settleMs !== undefined ? { settleMs: options.settleMs } : {}),
      ...(options.maxSettleMs !== undefined ? { maxSettleMs: options.maxSettleMs } : {}),
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
      send: (m) => ingestLocal(daemon, m),
      notice: (m) => say(pc.yellow(m)),
      ...(options.debug ? { log: say } : {}),
    });
    try {
      await collector.start();
      say(`watching ${pc.cyan(url)}. Click anything in the browser window.`);
    } catch (err) {
      say(pc.red((err as Error).message));
    }
  };

  const watcher = new UrlWatcher();
  const pipe = (stream: NodeJS.ReadableStream | null, out: NodeJS.WriteStream) => {
    stream?.on('data', (chunk: Buffer) => {
      out.write(chunk);
      const url = options.url ? undefined : watcher.push(chunk.toString());
      if (url) void openBrowser(url);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  if (options.url) void openBrowser(options.url);

  const code = await waitForExit(child);
  unsubscribe();
  await collector?.stop();
  await daemon.close();
  return code;
}

/** The collector runs in this process, so its messages skip HTTP and go straight to the correlator. */
function ingestLocal(daemon: RunningDaemon, message: IngestMessage): void {
  daemon.correlator.ingest('browser', message);
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolveExit) => {
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
    const onInt = forward('SIGINT');
    const onTerm = forward('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    child.on('exit', (code, signal) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      resolveExit(code ?? (signal ? 130 : 0));
    });
    child.on('error', (err) => {
      say(pc.red(`could not start command: ${err.message}`));
      resolveExit(127);
    });
  });
}
