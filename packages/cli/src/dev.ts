import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { BrowserCollector } from '@lightpath/browser';
import { type RunningDaemon, startDaemon } from '@lightpath/daemon';
import { registerUrl } from '@lightpath/node-agent';
import type { IngestMessage } from '@lightpath/protocol';
import pc from 'picocolors';
import { UrlWatcher } from './detect.js';
import { agentEnv, nodeVersionProblem, toShellCommand } from './env.js';
import { formatTrace } from './format.js';

export interface DevOptions {
  /** The user's dev command and its arguments, e.g. ['npm', 'run', 'dev']. */
  command: string[];
  /** App URL; detected from the command's output when omitted. */
  url?: string | undefined;
  /** Directory Vite (or another dev server) serves from. Defaults to cwd. */
  webRoot?: string | undefined;
  /** Extra origins to tag with the trace header, besides the app's own. */
  backend?: string[] | undefined;
  roots?: string[] | undefined;
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
  const [cmd, ...args] = options.command;
  if (!cmd) {
    say(pc.red('missing command. Usage: lightpath dev -- npm run dev'));
    return 1;
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const roots = (options.roots?.length ? options.roots : [cwd]).map((r) => resolve(cwd, r));
  const daemon = await startDaemon({ workspaceRoots: roots, ...(options.debug ? { log: say } : {}) });
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
  const child =
    process.platform === 'win32'
      ? spawn(toShellCommand([cmd, ...args]), { ...spawnOptions, shell: true })
      : spawn(cmd, args, spawnOptions);

  let collector: BrowserCollector | undefined;
  const openBrowser = async (url: string) => {
    if (options.browser === false || collector) return;
    const origin = new URL(url).origin;
    daemon.correlator.addDevServer(origin, resolve(cwd, options.webRoot ?? '.'));
    collector = new BrowserCollector({
      url,
      backendOrigins: [origin, ...(options.backend ?? [])],
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
      send: (m) => ingestLocal(daemon, m),
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
