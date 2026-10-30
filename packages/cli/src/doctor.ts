import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '@lightpath-dev/browser';
import { findDiscovery } from '@lightpath-dev/daemon';
import { registerUrl } from '@lightpath-dev/node-agent';
import { DISCOVERY_FILE } from '@lightpath-dev/protocol';
import pc from 'picocolors';
import { CONFIG_FILE, ConfigError, loadConfig } from './config.js';
import { nodeVersionProblem } from './env.js';

interface Check {
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
  ];

  let failed = 0;
  for (const check of checks) {
    const { ok, detail } = await check.run();
    if (!ok) failed++;
    process.stdout.write(`${ok ? pc.green('✓') : pc.red('✗')} ${check.name}: ${detail}\n`);
  }
  return failed === 0 ? 0 : 1;
}
