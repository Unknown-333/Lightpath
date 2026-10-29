import { readFileSync } from 'node:fs';
import { runMcpServer } from '@lightpath-dev/mcp';
import { cac } from 'cac';
import { CONFIG_FILE, ConfigError, loadConfig } from './config.js';
import { dev } from './dev.js';
import { doctor } from './doctor.js';

/** This package's version, read from package.json (one folder up from both src/ and dist/). */
export const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const list = (v: string | string[] | undefined): string[] | undefined =>
  v === undefined
    ? undefined
    : (Array.isArray(v) ? v : [v]).flatMap((s) => String(s).split(',')).filter(Boolean);

/** Builds the CLI. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const cli = cac('lightpath');
  let result: Promise<number> = Promise.resolve(0);

  cli
    .command('dev', 'Run your dev command with Lightpath, open your app, and print the code each click ran')
    .usage('dev [options] -- <command...>')
    .option('--url <url>', 'App URL (default: detected from the command output)')
    .option('--web-root <dir>', 'Directory the dev server serves from (default: current directory)')
    .option('--backend <origin>', 'Extra backend origin to tag with the trace header (repeatable)')
    .option('--root <dir>', 'Workspace root to show files from (repeatable; default: current directory)')
    .option('--ignore <glob>', 'Leave matching workspace files out of traces (repeatable)')
    .option('--config <file>', `Config file (default: ${CONFIG_FILE} in the current directory, if any)`)
    .option('--no-browser', "Don't open a browser; trace backend requests only")
    .option('--headless', 'Run the browser without a window')
    .option('--debug', 'Print Lightpath internals')
    .example('lightpath dev -- npm run dev')
    .example('lightpath dev --url http://localhost:5173 -- pnpm dev')
    .example(`lightpath dev   (runs "command" from ${CONFIG_FILE})`)
    .action((options: Record<string, unknown>) => {
      result = (async () => {
        let loaded: Awaited<ReturnType<typeof loadConfig>>;
        try {
          loaded = await loadConfig(process.cwd(), options.config as string | undefined);
        } catch (err) {
          if (!(err instanceof ConfigError)) throw err;
          process.stderr.write(`lightpath: ${err.message}\n`);
          return 1;
        }
        const config = loaded?.config ?? {};
        const flagCommand = (options['--'] as string[] | undefined) ?? [];
        // cac fills in browser: true for --no-browser's default, so read the flag from argv.
        const end = argv.indexOf('--');
        const noBrowser = (end < 0 ? argv : argv.slice(0, end)).includes('--no-browser');
        return dev({
          command: flagCommand.length > 0 ? flagCommand : (config.command ?? []),
          url: (options.url as string | undefined) ?? config.url,
          webRoot: (options.webRoot as string | undefined) ?? config.webRoot,
          backend: list(options.backend as string | string[] | undefined) ?? config.backend,
          roots: list(options.root as string | string[] | undefined) ?? config.roots,
          ignore: [
            ...(config.ignore ?? []),
            ...(list(options.ignore as string | string[] | undefined) ?? []),
          ],
          settleMs: config.settleMs,
          maxSettleMs: config.maxSettleMs,
          browser: noBrowser ? false : config.browser,
          headless: options.headless === true ? true : config.headless,
          debug: options.debug as boolean | undefined,
        });
      })();
    });

  cli
    .command('mcp', 'Run the MCP server over stdio for coding agents (reads .lightpath/daemon.json)')
    .option(
      '--root <dir>',
      'Where to look for .lightpath/daemon.json, then in each parent (default: current directory)',
    )
    .action((options: Record<string, unknown>) => {
      result = runMcpServer({ workspaceRoot: (options.root as string | undefined) ?? process.cwd() }).then(
        () => new Promise<number>(() => {}), // stays alive until the client closes stdin
      );
    });

  cli
    .command('doctor', 'Check that Lightpath can run here')
    .option('--config <file>', `Config file to check (default: ${CONFIG_FILE})`)
    .action((options: Record<string, unknown>) => {
      result = doctor(process.cwd(), options.config as string | undefined);
    });

  cli.help();
  cli.version(VERSION);
  cli.parse(argv, { run: false });
  if (!cli.matchedCommand && !cli.options.help && !cli.options.version) {
    cli.outputHelp();
    return cli.args.length > 0 ? 1 : 0;
  }
  await cli.runMatchedCommand();
  return result;
}
