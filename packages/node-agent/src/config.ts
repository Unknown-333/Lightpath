/**
 * Environment variables set by `lightpath dev`. Names mirror `AgentEnv` in @lightpath/protocol;
 * they're duplicated because the agent must not import runtime code (ADR 0002).
 * test/config.test.ts checks the two stay in sync.
 */
export const ENV = {
  url: 'LIGHTPATH_URL',
  token: 'LIGHTPATH_TOKEN',
  roots: 'LIGHTPATH_ROOTS',
  skip: 'LIGHTPATH_SKIP',
  debug: 'LIGHTPATH_DEBUG',
} as const;

/** Processes that inherit NODE_OPTIONS but aren't the user's app: package managers and dev tools. */
const DEFAULT_SKIP = [
  // Installed as a package: .../node_modules/vite/bin/vite.js, .../node_modules/npm/bin/npm-cli.js.
  // tsx's CLI process is skipped; the child it spawns to run your file is instrumented.
  /[\\/]node_modules[\\/](?:(?:npm|pnpm|yarn|corepack|vite|typescript|esbuild|vitest|playwright(?:-core)?|@biomejs[\\/]biome)[\\/]|tsx[\\/]dist[\\/]cli\.)/,
  // Standalone shims and corepack caches: .../corepack/v1/pnpm/12.16.1/bin/pnpm.cjs
  /[\\/](npm|npx|pnpm|pnpx|yarn|corepack)(-cli)?(\.c?js)?(\s|$)/,
];

export interface AgentConfig {
  url: string;
  token: string;
  /** Absolute workspace roots with forward slashes, lowercase on Windows for comparison. */
  roots: string[];
  debug: boolean;
}

export type ConfigResult = { ok: true; config: AgentConfig } | { ok: false; reason: string };

export function readConfig(env: NodeJS.ProcessEnv, argv: readonly string[]): ConfigResult {
  const url = env[ENV.url];
  const token = env[ENV.token];
  if (!url || !token) return { ok: false, reason: 'not launched by lightpath (no LIGHTPATH_URL/TOKEN)' };

  const cmdline = argv.join(' ');
  const customSkip = env[ENV.skip];
  if (DEFAULT_SKIP.some((re) => re.test(cmdline)))
    return { ok: false, reason: `skipped tool process: ${cmdline}` };
  if (customSkip) {
    try {
      if (new RegExp(customSkip).test(cmdline)) return { ok: false, reason: `skipped by ${ENV.skip}` };
    } catch {
      // An invalid user regex must not break their process; ignore it.
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `invalid ${ENV.url}` };
  }
  // The daemon binds to loopback only. Refuse to send source code anywhere else.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    return { ok: false, reason: `${ENV.url} must point at localhost` };
  }

  const roots = (env[ENV.roots] ?? process.cwd())
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map(normalizeRoot);
  return { ok: true, config: { url: url.replace(/\/$/, ''), token, roots, debug: env[ENV.debug] === '1' } };
}

export function normalizeRoot(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/$/, '');
  return /^[a-zA-Z]:/.test(slashed) ? slashed.toLowerCase() : slashed;
}
