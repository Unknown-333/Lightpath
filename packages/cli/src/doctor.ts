import { launchBrowser } from '@lightpath-dev/browser';
import { readDiscovery } from '@lightpath-dev/daemon';
import pc from 'picocolors';
import { nodeVersionProblem } from './env.js';

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

/** `lightpath doctor`: checks the environment and explains what to fix. */
export async function doctor(cwd: string): Promise<number> {
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
      name: 'Daemon for this workspace',
      run: async () => {
        const info = await readDiscovery(cwd);
        if (!info) return { ok: true, detail: 'not running (start it with lightpath dev)' };
        try {
          const res = await fetch(`http://127.0.0.1:${info.port}/v1/health`);
          return { ok: res.ok, detail: `running on port ${info.port}, pid ${info.pid}` };
        } catch {
          return {
            ok: false,
            detail: `stale .lightpath/daemon.json (port ${info.port} not answering); delete it`,
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
