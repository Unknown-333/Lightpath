import { AgentEnv } from '@lightpath-dev/protocol';

/**
 * Adds `--import="<url>"` to NODE_OPTIONS without dropping the user's own options (ARCHITECTURE 10).
 * The URL must be a file:// URL on Windows (measured); quoting handles spaces in paths.
 */
export function withImport(existing: string | undefined, importUrl: string): string {
  const flag = `--import="${importUrl}"`;
  const current = existing?.trim() ?? '';
  if (current.includes(importUrl)) return current;
  return current ? `${current} ${flag}` : flag;
}

export interface AgentEnvInput {
  daemonUrl: string;
  token: string;
  roots: string[];
  registerUrl: string;
  skip?: string | undefined;
  debug?: boolean | undefined;
}

/** Environment for the user's dev command, so every Node process it starts loads the agent. */
export function agentEnv(base: NodeJS.ProcessEnv, input: AgentEnvInput): NodeJS.ProcessEnv {
  return {
    ...base,
    NODE_OPTIONS: withImport(base.NODE_OPTIONS, input.registerUrl),
    [AgentEnv.url]: input.daemonUrl,
    [AgentEnv.token]: input.token,
    [AgentEnv.roots]: input.roots.join(','),
    ...(input.skip ? { [AgentEnv.skip]: input.skip } : {}),
    ...(input.debug ? { [AgentEnv.debug]: '1' } : {}),
  };
}

/** Node versions the agent supports: 22.12+ (ADR 0002). */
export function nodeVersionProblem(version: string): string | undefined {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 12)) return undefined;
  return `Lightpath needs Node.js 22.12 or newer; this is ${version}.`;
}

/**
 * Joins the user's command for `spawn(line, { shell: true })` on Windows, where `npm` and other
 * `.cmd` shims need a shell. Node 24 deprecates passing an argument array with `shell: true`
 * (DEP0190), so arguments are quoted here. The input is the user's own command line.
 */
export function toShellCommand(argv: readonly string[]): string {
  return argv.map((a) => (/^[\w./:=@+-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)).join(' ');
}
