import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

/** What `lightpath mcp` knows to start Lightpath by itself (D-122), from the CLI and the config. */
export interface AutoStartOptions {
  /** The CLI's `bin.js`, run with this Node as `dev --headless`. */
  bin: string;
  /** `command` from lightpath.config.json in the server's root, if any. */
  command?: string | string[] | undefined;
  /** `autoStart` from that config: only `true` starts anything. */
  autoStart?: boolean | undefined;
}

/** Longest wait for the started daemon, and for run_action, its browser (design section 11). */
export const AUTO_START_WAIT_MS = 60_000;
export const DEV_LOG = '.lightpath/dev.log';

export const commandText = (c: string | string[]) => (typeof c === 'string' ? c : c.join(' '));

/**
 * Starts `lightpath dev --headless` once, as a child of this MCP server, with its output appended
 * to `.lightpath/dev.log`. The child doesn't hold this process open, and its whole tree is stopped
 * when this process exits. A hard kill of this process leaves it running; its discovery file
 * then lets the next MCP server reuse it.
 */
export class AutoStarter {
  readonly #root: string;
  readonly #opts: AutoStartOptions | undefined;
  #child: ChildProcess | undefined;

  constructor(root: string, opts: AutoStartOptions | undefined) {
    this.#root = root;
    this.#opts = opts;
  }

  /** True when the config allows a start: `command` and `autoStart: true`. */
  get enabled(): boolean {
    return Boolean(this.#opts?.autoStart && this.#opts.command && this.#opts.bin);
  }

  get pid(): number | undefined {
    return this.#child?.exitCode === null ? this.#child.pid : undefined;
  }

  /** The message for a tool when Lightpath isn't running and nothing may start it. */
  notRunning(): string {
    const cmd = this.#opts?.command;
    if (cmd) {
      return (
        `Lightpath isn't running in ${this.#root}. Start it with: lightpath dev (it runs "${commandText(cmd)}" from lightpath.config.json). ` +
        'To let tools start it by themselves, set "autoStart": true in lightpath.config.json.'
      );
    }
    return `Lightpath isn't running in ${this.#root}. Start it with: lightpath dev -- <your dev command>`;
  }

  /** Starts the child if it isn't running. Returns the line a tool result starts with. */
  start(): string {
    const opts = this.#opts as AutoStartOptions;
    const note = `started lightpath dev ("${commandText(opts.command as string | string[])}") in the background; log: ${DEV_LOG}`;
    if (this.pid !== undefined) return note;
    mkdirSync(join(this.#root, '.lightpath'), { recursive: true });
    const log = openSync(join(this.#root, DEV_LOG), 'a');
    try {
      this.#child = spawn(process.execPath, [opts.bin, 'dev', '--headless'], {
        cwd: this.#root,
        stdio: ['ignore', log, log],
        // On POSIX a process group, so the dev command's own children stop with it.
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } finally {
      closeSync(log);
    }
    this.#child.unref();
    process.once('exit', () => this.stop());
    return note;
  }

  /** Stops the child and its whole tree. Synchronous, so it can run in an `exit` handler. */
  stop(): void {
    const pid = this.pid;
    this.#child = undefined;
    if (pid === undefined) return;
    try {
      if (process.platform === 'win32')
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}
