import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CONFIG_FILE, LightpathConfig } from './config.js';

/** The agents `lightpath init --agent` knows (design section 10.1, D-120). */
export const AGENTS = ['claude-code', 'cursor', 'vscode', 'kiro'] as const;
export type Agent = (typeof AGENTS)[number];

interface AgentSetup {
  /** Project MCP config file, relative to the project folder. */
  file: string;
  /** Top-level key that holds the servers. */
  key: 'mcpServers' | 'servers';
  /** Extra fields each server entry needs. */
  extra: Record<string, string>;
  name: string;
}

/** Per-agent files and shapes, from docs/research/agent-mcp-behavior.md (from docs). */
export const AGENT_SETUP: Record<Agent, AgentSetup> = {
  'claude-code': { file: '.mcp.json', key: 'mcpServers', extra: {}, name: 'Claude Code' },
  cursor: { file: '.cursor/mcp.json', key: 'mcpServers', extra: {}, name: 'Cursor' },
  vscode: { file: '.vscode/mcp.json', key: 'servers', extra: { type: 'stdio' }, name: 'VS Code' },
  kiro: { file: '.kiro/settings/mcp.json', key: 'mcpServers', extra: {}, name: 'Kiro' },
};

export const SERVER_NAME = 'lightpath';
export const PACKAGE = '@lightpath-dev/cli';

export interface McpEntry {
  type?: string;
  command: string;
  args: string[];
}

/**
 * The command a client runs to start `lightpath mcp`, pinned to this CLI's version so `lightpath
 * mcp` and `lightpath dev` speak the same protocol. Windows wraps it in `cmd /c`, because `npx` is
 * a `.cmd` shim that a client starting it without a shell can't run.
 */
export function mcpCommand(version: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  const npx = ['-y', `${PACKAGE}@${version}`, 'mcp'];
  return platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...npx] }
    : { command: 'npx', args: npx };
}

export function mcpEntry(agent: Agent, version: string, platform: NodeJS.Platform): McpEntry {
  return { ...AGENT_SETUP[agent].extra, ...mcpCommand(version, platform) };
}

export const BLOCK_START = '<!-- lightpath:start -->';
export const BLOCK_END = '<!-- lightpath:end -->';

/**
 * The marked block for AGENTS.md and CLAUDE.md (design section 10.1). Every tool it names comes
 * from `tools`, the server's own `tools/list`, so it can't name a tool the server lacks. Before
 * run_action ships, the first and third lines name the tools that exist.
 */
export function agentsBlock(tools: readonly string[]): string {
  const has = (t: string) => tools.includes(t);
  const lines = [
    BLOCK_START,
    '## Lightpath: what code actually ran',
    '',
    'This app runs under `lightpath dev`, which records the source files, functions and lines that ran, frontend and backend, for each click, key press or request.',
    '',
  ];
  if (has('run_action')) {
    lines.push(
      // D-134: a user's bug report comes first, and a flow is replayed one call per step.
      '- When the user reports a bug they see in the app, or asks which code handles a button, page or request, reproduce it with the Lightpath MCP tool `run_action` before searching files. Each call is one step, like `button "Save"`, and the page, sign-in and data stay between calls: sign in with `fill`, do the setup steps, then the step that shows the bug.' +
        (has('find_code_for_action')
          ? ' To read the last recorded action instead, call `find_code_for_action`.'
          : ''),
    );
  } else if (has('find_code_for_action')) {
    lines.push(
      '- When the user reports a bug they see in the app, or asks which code handles a button, page or request, do that action in the app, then call the Lightpath MCP tool `find_code_for_action` with words from the button or link label, like `Save`, before searching files.',
    );
  }
  lines.push('- Output is capped. To see more, follow its "not shown" line.');
  if (has('run_action')) {
    // D-144: the fix check is one call; diff_traces stays for any two traces.
    lines.push(
      '- After a fix, call `run_action` again with the same target and `compareTo: "last"`: it returns the new trace and what changed, function by function.',
    );
  } else if (has('diff_traces')) {
    lines.push('- After a fix, do the action again and compare the two traces with `diff_traces`.');
  }
  lines.push(
    "- If Lightpath says it isn't running, start `lightpath dev` in the project folder, or ask the user to.",
    BLOCK_END,
  );
  return lines.join('\n');
}

/** Puts `block` between its markers in `text`, or appends it. Keeps the file's line endings. */
export function upsertBlock(text: string | undefined, block: string): string {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n';
  const b = block.replace(/\n/g, eol);
  if (text === undefined || text.trim() === '') return `${b}${eol}`;
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END, start);
  if (start >= 0 && end > start) return text.slice(0, start) + b + text.slice(end + BLOCK_END.length);
  const sep = text.endsWith(`${eol}${eol}`) ? '' : text.endsWith(eol) ? eol : `${eol}${eol}`;
  return `${text}${sep}${b}${eol}`;
}

/** The block between the markers in `text`, markers included, or undefined. */
export function findBlock(text: string): string | undefined {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END, start);
  return start >= 0 && end > start
    ? text.slice(start, end + BLOCK_END.length).replace(/\r\n/g, '\n')
    : undefined;
}

/** The dev command from package.json's `dev` script, run with the lockfile's package manager. */
export function devCommand(dir: string, pkg: { scripts?: Record<string, string> }): string | undefined {
  if (!pkg.scripts?.dev) return undefined;
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm run dev';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn dev';
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun run dev';
  return 'npm run dev';
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses a JSON file that may start with a byte order mark. Undefined when it isn't plain JSON. */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

/** Same path as the README's config example. */
const SCHEMA_URL = './node_modules/@lightpath-dev/cli/lightpath.config.schema.json';

export interface InitOptions {
  cwd: string;
  agent: Agent;
  version: string;
  /** The server's tool names (from `serverToolNames`). */
  tools: readonly string[];
  platform?: NodeJS.Platform;
  out?: (line: string) => void;
}

type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped';

/** `lightpath init --agent <agent>`. Returns the exit code. Running it twice changes nothing. */
export async function init(options: InitOptions): Promise<number> {
  const { cwd, agent, version, tools } = options;
  const platform = options.platform ?? process.platform;
  const out = options.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const setup = AGENT_SETUP[agent];

  const pkgRaw = await readFile(join(cwd, 'package.json'), 'utf8').catch(() => undefined);
  const pkg = pkgRaw === undefined ? undefined : parseJson(pkgRaw);
  if (!isPlainObject(pkg)) {
    out(
      pkgRaw === undefined
        ? `lightpath init: no package.json in ${cwd}. Run it in your project folder.`
        : `lightpath init: ${join(cwd, 'package.json')} isn't valid JSON.`,
    );
    return 1;
  }

  let failed = false;
  const report = (outcome: Outcome, file: string, note = '') => out(`${outcome.padEnd(9)} ${file}${note}`);

  // 1. The agent's MCP config, merged into what is there.
  const entry = mcpEntry(agent, version, platform);
  const configPath = join(cwd, setup.file);
  const raw = await readFile(configPath, 'utf8').catch(() => undefined);
  const parsed = raw === undefined || raw.trim() === '' ? {} : parseJson(raw);
  if (!isPlainObject(parsed) || (parsed[setup.key] !== undefined && !isPlainObject(parsed[setup.key]))) {
    failed = true;
    report('skipped', setup.file, " (not plain JSON, or its servers aren't an object; left as is)");
    out(`Add this under "${setup.key}" in ${setup.file} by hand:`);
    out(JSON.stringify({ [SERVER_NAME]: entry }, null, 2));
  } else {
    const servers = (parsed[setup.key] ?? {}) as Record<string, unknown>;
    const next = { ...parsed, [setup.key]: { ...servers, [SERVER_NAME]: entry } };
    report(await writeIfChanged(configPath, raw, `${JSON.stringify(next, null, 2)}\n`), setup.file);
  }

  // 2. lightpath.config.json: only the keys it lacks.
  const lpPath = join(cwd, CONFIG_FILE);
  const lpRaw = await readFile(lpPath, 'utf8').catch(() => undefined);
  const lp = lpRaw === undefined ? {} : parseJson(lpRaw);
  const command = devCommand(cwd, pkg as { scripts?: Record<string, string> });
  if (!isPlainObject(lp)) {
    failed = true;
    report('skipped', CONFIG_FILE, " (isn't valid JSON; left as is)");
  } else {
    const add: Record<string, unknown> = {};
    if (lp.$schema === undefined) add.$schema = SCHEMA_URL;
    if (lp.command === undefined && command) add.command = command;
    // autoStart (D-122) is written only once the config schema knows the key, so this CLI never
    // writes a file its own `lightpath dev` would reject.
    if (
      lp.autoStart === undefined &&
      (lp.command !== undefined || command) &&
      'autoStart' in LightpathConfig.shape
    ) {
      add.autoStart = true;
    }
    const next = { ...lp, ...add };
    report(await writeIfChanged(lpPath, lpRaw, `${JSON.stringify(next, null, 2)}\n`), CONFIG_FILE);
    if (lp.command === undefined && !command) {
      out(
        'note      package.json has no "dev" script, so no "command" was written and auto-start stays off.',
      );
    }
  }

  // 3. The marked block in AGENTS.md, and in CLAUDE.md when it exists.
  const block = agentsBlock(tools);
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const path = join(cwd, name);
    const text = await readFile(path, 'utf8').catch(() => undefined);
    if (name === 'CLAUDE.md' && text === undefined) continue;
    report(await writeIfChanged(path, text, upsertBlock(text, block)), name);
  }

  if (agent === 'kiro') {
    out(
      'note      Kiro custom agents see AGENTS.md only with "resources": ["file://AGENTS.md"] in the agent file.',
    );
  }
  out(
    failed
      ? 'Some files need a hand edit (above).'
      : `Done. Restart ${setup.name} so it loads the server, then run lightpath doctor.`,
  );
  return failed ? 1 : 0;
}

async function writeIfChanged(path: string, before: string | undefined, after: string): Promise<Outcome> {
  if (before === after) return 'unchanged';
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, after);
  return before === undefined ? 'created' : 'updated';
}
