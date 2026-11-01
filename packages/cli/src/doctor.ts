import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '@lightpath-dev/browser';
import { findDiscovery } from '@lightpath-dev/daemon';
import { registerUrl } from '@lightpath-dev/node-agent';
import { DISCOVERY_FILE } from '@lightpath-dev/protocol';
import pc from 'picocolors';
import { CONFIG_FILE, ConfigError, loadConfig } from './config.js';
import { nodeVersionProblem } from './env.js';
import {
  AGENT_SETUP,
  AGENTS,
  agentsBlock,
  findBlock,
  mcpCommand,
  PACKAGE,
  parseJson,
  SERVER_NAME,
} from './init.js';
import { VERSION } from './main.js';
import { type ProbeResult, probeMcpCommand, serverToolNames } from './mcp-probe.js';

export interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

/** `lightpath doctor`: checks the environment and explains what to fix. */
export async function doctor(cwd: string, configFile?: string): Promise<number> {
  const checks: Check[] = [
    {
      name: 'Node.js version',
      run: async () => {
        const problem = nodeVersionProblem(process.version);
        return { ok: !problem, detail: problem ?? process.version };
      },
    },
    {
      name: 'Chromium-based browser',
      run: async () => {
        try {
          const browser = await launchBrowser({ headless: true });
          const version = browser.version();
          await browser.close();
          return { ok: true, detail: version };
        } catch (err) {
          return { ok: false, detail: (err as Error).message };
        }
      },
    },
    {
      name: 'Node agent',
      run: async () => {
        const path = fileURLToPath(registerUrl);
        return existsSync(path)
          ? { ok: true, detail: path }
          : { ok: false, detail: `missing ${path}; reinstall @lightpath-dev/cli` };
      },
    },
    {
      name: 'Config file',
      run: async () => {
        try {
          const loaded = await loadConfig(cwd, configFile);
          if (!loaded) return { ok: true, detail: `none (optional; see ${CONFIG_FILE} in the README)` };
          const keys = Object.keys(loaded.config).filter((k) => k !== '$schema');
          return { ok: true, detail: `${loaded.path} (${keys.join(', ') || 'empty'})` };
        } catch (err) {
          if (err instanceof ConfigError) return { ok: false, detail: err.message };
          throw err;
        }
      },
    },
    {
      name: 'Daemon for this workspace',
      run: async () => {
        // Look where `lightpath mcp` looks: here, then each parent (D-102).
        const found = await findDiscovery(cwd);
        if (!found) return { ok: true, detail: 'not running (start it with lightpath dev)' };
        const { root, info } = found;
        const where = root === resolve(cwd) ? '' : ` (started in ${root})`;
        try {
          const res = await fetch(`http://127.0.0.1:${info.port}/v1/health`);
          return { ok: res.ok, detail: `running on port ${info.port}, pid ${info.pid}${where}` };
        } catch {
          return {
            ok: false,
            detail: `stale ${join(root, DISCOVERY_FILE)} (port ${info.port} not answering); delete it`,
          };
        }
      },
    },
    ...(await setupChecks(cwd, configFile)),
  ];

  let failed = 0;
  for (const check of checks) {
    const { ok, detail } = await check.run();
    if (!ok) failed++;
    process.stdout.write(`${ok ? pc.green('✓') : pc.red('✗')} ${check.name}: ${detail}\n`);
  }
  return failed === 0 ? 0 : 1;
}

export interface SetupCheckOptions {
  platform?: NodeJS.Platform;
  version?: string;
  /** Starts an MCP command; tests pass a fake. */
  probe?: typeof probeMcpCommand;
  /** The tool names this CLI ships; tests pass a fixed list. */
  tools?: readonly string[];
}

/**
 * Checks what `lightpath init` wrote (design section 10.2, D-120): each agent's MCP config, the
 * command's form for this OS, that the command starts offline and lists this CLI's tools, the
 * AGENTS.md and CLAUDE.md blocks, and the config file's `command` and `autoStart`.
 */
export async function setupChecks(
  cwd: string,
  configFile?: string,
  options: SetupCheckOptions = {},
): Promise<Check[]> {
  const platform = options.platform ?? process.platform;
  const version = options.version ?? VERSION;
  const probe = options.probe ?? probeMcpCommand;
  const tools = options.tools ?? (await serverToolNames(version));
  const expected = mcpCommand(version, platform);
  const checks: Check[] = [];
  const started = new Map<string, Promise<ProbeResult>>();
  let configured = 0;

  for (const agent of AGENTS) {
    const setup = AGENT_SETUP[agent];
    const raw = await readFile(join(cwd, setup.file), 'utf8').catch(() => undefined);
    if (raw === undefined) continue;
    const json = parseJson(raw) as Record<string, Record<string, unknown> | undefined> | undefined;
    const name = `${setup.name} MCP config`;
    if (json === undefined || typeof json !== 'object' || json === null) {
      if (raw.includes(`"${SERVER_NAME}"`)) {
        configured++;
        checks.push({
          name,
          run: async () => ({
            ok: false,
            detail: `${setup.file} isn't plain JSON (comments?), so it can't be checked; remove the comments or check the "${SERVER_NAME}" entry by hand`,
          }),
        });
      }
      continue;
    }
    const entry = json[setup.key]?.[SERVER_NAME] as
      | { type?: unknown; command?: unknown; args?: unknown }
      | undefined;
    if (entry === undefined) continue;
    configured++;
    checks.push({
      name,
      run: async () => {
        const command = entry.command;
        const args = entry.args;
        if (
          typeof command !== 'string' ||
          !Array.isArray(args) ||
          !args.every((a) => typeof a === 'string')
        ) {
          return {
            ok: false,
            detail: `${setup.file}: "${SERVER_NAME}" needs a string "command" and string "args"`,
          };
        }
        if (setup.extra.type && entry.type !== setup.extra.type) {
          return { ok: false, detail: `${setup.file}: "${SERVER_NAME}" needs "type": "${setup.extra.type}"` };
        }
        const shown = [command, ...args].join(' ');
        if (platform === 'win32' && command === 'npx') {
          return {
            ok: false,
            detail: `${setup.file} starts a bare npx, which a client can't start on Windows without a shell. Use "command": "cmd", "args": ${JSON.stringify(expected.args)} (lightpath init --agent ${agent} writes it)`,
          };
        }
        if (platform !== 'win32' && command === 'cmd') {
          return {
            ok: false,
            detail: `${setup.file} starts "cmd", which exists only on Windows. Use "command": "npx", "args": ${JSON.stringify(expected.args)} (lightpath init --agent ${agent} writes it)`,
          };
        }
        const pinned = args.find((a) => a.startsWith(`${PACKAGE}@`));
        if (pinned && pinned !== `${PACKAGE}@${version}`) {
          return {
            ok: false,
            detail: `${setup.file} pins ${pinned}, but this CLI is ${version}; run lightpath init --agent ${agent} again`,
          };
        }
        const key = JSON.stringify([command, args]);
        if (!started.has(key)) {
          // Offline, so npx can't download anything: a doctor that downloads would be a new network call.
          started.set(
            key,
            probe(command, args, {
              cwd,
              env: { ...process.env, npm_config_offline: 'true' },
              timeoutMs: 20_000,
              version,
            }),
          );
        }
        const result = await (started.get(key) as Promise<ProbeResult>);
        if (!result.ok) {
          if (/ENOTCACHED|offline/i.test(result.stderr)) {
            return {
              ok: true,
              detail: `${shown}: npx would download ${pinned ?? PACKAGE} on first start; not checked offline`,
            };
          }
          const tail = result.stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
          return {
            ok: false,
            detail: `${shown} didn't answer initialize and tools/list: ${result.error}${result.exit ? ` (exit ${result.exit})` : ''}${tail ? `; stderr: ${tail}` : ''}`,
          };
        }
        const missing = tools.filter((t) => !result.tools?.includes(t));
        if (missing.length > 0) {
          return {
            ok: false,
            detail: `${shown} answered with ${result.tools?.length ?? 0} tools, missing ${missing.join(', ')}`,
          };
        }
        return { ok: true, detail: `${shown} starts and lists ${result.tools?.length ?? 0} tools` };
      },
    });
  }

  const block = agentsBlock(tools);
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const text = await readFile(join(cwd, file), 'utf8').catch(() => undefined);
    if (text === undefined && (file === 'CLAUDE.md' || configured === 0)) continue;
    checks.push({
      name: `${file} block`,
      run: async () => {
        if (text === undefined)
          return { ok: false, detail: `no ${file}; run lightpath init --agent <agent>` };
        const found = findBlock(text);
        if (found === undefined) {
          return { ok: false, detail: `${file} has no Lightpath block; run lightpath init --agent <agent>` };
        }
        if (found !== block) {
          const named = [...found.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1] as string);
          const unknown = [...new Set(named)].filter((t) => !tools.includes(t));
          return {
            ok: false,
            detail: `${file} block is out of date${unknown.length ? ` (names ${unknown.join(', ')}, which this server doesn't have)` : ''}; run lightpath init --agent <agent> again`,
          };
        }
        return { ok: true, detail: `names only tools the server lists (${tools.length} tools)` };
      },
    });
  }

  if (configured === 0) {
    checks.push({
      name: 'Agent setup',
      run: async () => ({
        ok: true,
        detail: `none found (optional; lightpath init --agent <${AGENTS.join('|')}>)`,
      }),
    });
    return checks;
  }

  checks.push({
    name: 'Auto-start',
    run: async () => {
      try {
        const loaded = await loadConfig(cwd, configFile);
        const config = (loaded?.config ?? {}) as { command?: string | string[]; autoStart?: boolean };
        if (config.command === undefined) {
          return {
            ok: true,
            detail: `no "command" in ${CONFIG_FILE}, so lightpath mcp can't start lightpath dev by itself`,
          };
        }
        const command = Array.isArray(config.command) ? config.command.join(' ') : config.command;
        return {
          ok: true,
          detail: `command "${command}", autoStart ${config.autoStart === true ? 'on' : 'off'}`,
        };
      } catch (err) {
        if (err instanceof ConfigError) return { ok: false, detail: err.message };
        throw err;
      }
    },
  });
  return checks;
}
